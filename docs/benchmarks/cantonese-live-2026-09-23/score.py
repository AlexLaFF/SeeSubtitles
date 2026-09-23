import gzip, json, pathlib, statistics, random, re, unicodedata
from collections import defaultdict
ROOT=pathlib.Path(__file__).resolve().parent
from opencc import OpenCC
T2S=OpenCC('t2s').convert
CHAR_LANGS={'zh','yue','ja','ko','th'}
def norm(text, lang):
    t = unicodedata.normalize('NFKC', text).lower()
    if lang in ('zh', 'yue'):
        t = T2S(t)
    t = re.sub(r"[^\w\s']|_", ' ', t)
    return t


def units(text, lang):
    t = norm(text, lang)
    if lang in CHAR_LANGS:
        return [c for c in t if not c.isspace()]
    return t.split()


def edit(a, b):
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def err(hyp, ref, lang):
    r = units(ref, lang)
    h = units(hyp, lang)
    if not r:
        return 0.0
    return min(1.0, edit(h, r) / len(r))


def chrf(hyp, ref, n=6, beta=2.0):
    h = re.sub(r'\s+', '', unicodedata.normalize('NFKC', hyp))
    r = re.sub(r'\s+', '', unicodedata.normalize('NFKC', ref))
    if not h or not r:
        return 0.0
    ps, rs = [], []
    for k in range(1, n + 1):
        hg = defaultdict(int); rg = defaultdict(int)
        for i in range(len(h) - k + 1): hg[h[i:i + k]] += 1
        for i in range(len(r) - k + 1): rg[r[i:i + k]] += 1
        if not hg or not rg:
            continue
        match = sum(min(c, rg[g]) for g, c in hg.items())
        ps.append(match / sum(hg.values())); rs.append(match / sum(rg.values()))
    if not ps:
        return 0.0
    p = sum(ps) / len(ps); rr = sum(rs) / len(rs)
    if p + rr == 0:
        return 0.0
    return 100 * (1 + beta ** 2) * p * rr / (beta ** 2 * p + rr)


def assign(rows, turns):
    """Each recognised line to the turn it overlaps most (its midpoint's turn when it overlaps none)."""
    out = defaultdict(list)
    for row in rows:
        best, score = None, 0
        for i, t in enumerate(turns):
            ov = min(row['end'], t['endMs']) - max(row['start'], t['startMs'])
            if ov > score:
                best, score = i, ov
        if best is None:
            mid = (row['start'] + row['end']) / 2
            best = min(range(len(turns)), key=lambda i: abs((turns[i]['startMs'] + turns[i]['endMs']) / 2 - mid))
        out[best].append(row['text'])
    return out



turns=json.loads((ROOT/'turns.json').read_text());refs=json.loads((ROOT/'refs.json').read_text())
def stats(xs):
 return {'n':len(xs),'median':statistics.median(xs) if xs else None,'p95':sorted(xs)[min(len(xs)-1,int((len(xs)-1)*.95))] if xs else None}
def overlap(r,t):return max(0,min(r['end'],t['endMs'])-max(r['start'],t['startMs']))
reports={}
for arm in ['tencent','fun400']:
 d=json.loads(gzip.decompress((ROOT/(arm+'.json.gz')).read_bytes()));es=d['events']
 # Keep the last final for each sentence ID; drafts remain intact in the raw output.
 final={}
 for e in es:
  if e['type']=='sentence':final[(e['voiceId'],e['index'])]=e
 sr=sorted([{'start':e['startMs'],'end':e['endMs'],'text':e['text'],'at':e['at']} for e in final.values()],key=lambda x:x['start'])
 final={}
 for e in es:
  if e['type']=='caption' and e['sentenceEnd']:final[e['sentenceId']]=e
 cr=sorted([{'start':e['startTime'],'end':e['endTime'],'text':e['targetText'],'at':e['at']} for e in final.values()],key=lambda x:x['start'])
 rec=assign(sr,turns);tra=assign(cr,turns);per=[]
 for i,t in enumerate(turns):
  hyp=' '.join(rec.get(i,[]));trans=' '.join(tra.get(i,[]));ref=refs[t['id']]['zh']
  firsts=[x['at']-t['startMs'] for x in es if x['type'] in ('partial','sentence') and t['startMs']-200<=x['startMs']<t['endMs']]
  firstt=[x['at']-t['startMs'] for x in es if x['type']=='caption' and x['targetText'] and t['startMs']-200<=x['startTime']<t['endMs']]
  settled=[x['at']-t['endMs'] for x in cr if overlap(x,t)>0]
  ref_units=units(t['text'],'yue');distance=edit(units(hyp,'yue'),ref_units)
  per.append({'id':t['id'],'reference':t['text'],'source':hyp,'translation':trans,'mandarinReference':ref,'CER':distance/max(1,len(ref_units)),
   'chrF':chrf(T2S(trans),T2S(ref)),'firstSourceMs':min(firsts) if firsts else None,'firstTranslationMs':min(firstt) if firstt else None,'settledAfterTurnMs':max(settled) if settled else None})
 tokens={}
 for c in d['calls']:
  for k,v in (c.get('usage') or {}).items():
   if isinstance(v,(int,float)):tokens[k]=tokens.get(k,0)+v
 translationCost=(tokens.get('prompt_tokens',0)*.5+tokens.get('completion_tokens',0)*2)/1e6
 summary={'meanTurnCER':statistics.mean(x['CER'] for x in per),'meanMandarinChrF':statistics.mean(x['chrF'] for x in per),
  'lostTurns':sum(x['CER']>=.8 for x in per),'finals':len(sr),'crossTurnFinals':sum(sum(overlap(r,t)>300 for t in turns)>1 for r in sr),
  'firstSourceMs':stats([x['firstSourceMs'] for x in per if x['firstSourceMs'] is not None]),
  'firstTranslationMs':stats([x['firstTranslationMs'] for x in per if x['firstTranslationMs'] is not None]),
  'settledAfterTurnMs':stats([x['settledAfterTurnMs'] for x in per if x['settledAfterTurnMs'] is not None]),
  'tokens':tokens,'translationCostCNY':translationCost,'recognitionListCNYPerHour':4.8 if arm=='tencent' else 1.188,
  'estimatedTotalCNYPerHour':(4.8 if arm=='tencent' else 1.188)+translationCost/d['inputSeconds']*3600,
  'status':d['status'],'maxPacingErrorMs':d['maxPacingError']}
 a=units(' '.join(t['text'] for t in turns),'yue');b=units(' '.join(r['text'] for r in sr),'yue')
 summary['wholeStreamCER']=edit(a,b)/len(a)
 reports[arm]={'summary':summary,'turns':per}
 print(arm,json.dumps(summary,ensure_ascii=False))
rng=random.Random(86)
for metric in ['CER','chrF']:
 deltas=[f[metric]-t[metric] for f,t in zip(reports['fun400']['turns'],reports['tencent']['turns'])]
 samples=sorted(statistics.mean(rng.choices(deltas,k=len(deltas))) for _ in range(5000))
 reports.setdefault('pairedDifferences',{})[metric]={'funMinusTencent':statistics.mean(deltas),'bootstrap95':[samples[125],samples[4874]]}
(ROOT/'report.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2))
print('Paired differences',json.dumps(reports['pairedDifferences']))
