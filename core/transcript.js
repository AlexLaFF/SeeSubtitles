'use strict';
// In-memory transcript keyed by sentence id, survives WebSocket reconnects, and appends
// finished sentences to transcripts/<date>.txt.
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

class Transcript extends EventEmitter {
  constructor({ logDir, maxLines = 1000 } = {}) {
    super();
    this.logDir = logDir;
    this.maxLines = maxLines;
    this.lines = [];
    this.byId = new Map();
    this.seq = 0;
  }

  /** @param {{voiceId:string, sentenceId?:string, sourceText:string, targetText:string, startTime?:number, endTime?:number, sentenceEnd:boolean}} r */
  apply(r) {
    const id = r.sentenceId || `${r.voiceId}:${r.startTime ?? 'x'}`;
    let line = this.byId.get(id);
    const isNew = !line;
    if (!line) {
      line = { id, seq: ++this.seq, sourceText: '', targetText: '', ended: false, startTime: r.startTime ?? null, endTime: null, wallStart: null, wallEnd: null, createdAt: Date.now(), updatedAt: 0 };
      this.byId.set(id, line);
      this.lines.push(line);
      while (this.lines.length > this.maxLines) this.byId.delete(this.lines.shift().id);
    }
    if (typeof r.sourceText === 'string') line.sourceText = r.sourceText;
    if (typeof r.targetText === 'string') line.targetText = r.targetText;
    if (r.endTime != null) line.endTime = r.endTime;
    if (r.wallStart != null) line.wallStart = r.wallStart;
    if (r.wallEnd != null) line.wallEnd = r.wallEnd;
    line.ended = line.ended || !!r.sentenceEnd;
    line.updatedAt = Date.now();
    if (line.ended && !line.logged && (line.sourceText || line.targetText)) {
      line.logged = true;
      this._appendLog(line);
    }
    this.emit('line', line, isNew);
    return line;
  }

  recent(n = 50) {
    return this.lines.slice(-n);
  }

  clear() {
    this.lines = [];
    this.byId.clear();
    this.emit('clear');
  }

  toText() {
    return this.lines
      .map((l) => `${new Date(l.createdAt).toISOString()}\t${l.sourceText}\t${l.targetText}`)
      .join('\n');
  }

  _appendLog(line) {
    if (!this.logDir) return;
    try {
      fs.mkdirSync(this.logDir, { recursive: true });
      const d = new Date(line.createdAt);
      const file = path.join(this.logDir, `${d.toISOString().slice(0, 10)}.txt`);
      const ts = d.toTimeString().slice(0, 8);
      fs.appendFile(file, `${ts}\t${line.sourceText}\t${line.targetText}\n`, (err) => {
        if (err) this.emit('log', `transcript log: ${err.message}`);
      });
    } catch (err) {
      this.emit('log', `transcript log: ${err.message}`);
    }
  }
}

module.exports = { Transcript };
