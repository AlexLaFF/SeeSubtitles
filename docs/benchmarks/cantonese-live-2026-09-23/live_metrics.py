import gzip, json, pathlib, statistics
from collections import defaultdict
p=pathlib.Path(__file__).resolve().parent; turns=json.loads((p/'turns.json').read_text())
def stats(xs):
 xs=sorted(xs)
 return {'n':len(xs),'median':statistics.median(xs) if xs else None,'p95':xs[round((len(xs)-1)*.95)] if xs else None}
def bestturn(row):
 start=row['startTime'];end=row['endTime'];best=None;score=0
 for i,t in enumerate(turns):
  ov=min(end,t['endMs'])-max(start,t['startMs'])
  if ov>score:best=i;score=ov
 if best is None:
  mid=(start+end)/2;best=min(range(len(turns)),key=lambda i:abs((turns[i]['startMs']+turns[i]['endMs'])/2-mid))
 return best
out={}
for arm in ['tencent','fun400']:
 d=json.loads(gzip.decompress((p/(arm+'.json.gz')).read_bytes()));groups=defaultdict(list)
 for e in d['events']:
  if e['type']=='caption':groups[e['sentenceId']].append(e)
 byturn=defaultdict(list)
 for sid,es in groups.items():
  row=next((e for e in reversed(es) if e['sentenceEnd']),es[-1]);byturn[bestturn(row)].append(es)
 per=[]
 for i,t in enumerate(turns):
  first=[];last=[];confirmed=[];updates=0;rewrites=0;replacedChars=0;clears=0
  for es in byturn[i]:
   prev=''
   for e in es:
    cur=e.get('targetText','').strip()
    if cur==prev:continue
    if prev and not cur:clears+=1
    if cur and not prev:first.append(e['at'])
    if cur:
     updates+=1
     if prev and not cur.startswith(prev):
      rewrites+=1
      lcp=0
      for a,b in zip(prev,cur):
       if a!=b:break
       lcp+=1
      replacedChars+=len(prev)-lcp
     last.append(e['at'])
    prev=cur
   confirmed.extend(e['at'] for e in es if e['sentenceEnd'])
  per.append({'id':t['id'],'firstVisibleMs':min(first)-t['startMs'] if first else None,'lastChangeAfterTurnMs':max(last)-t['endMs'] if last else None,'finalConfirmedAfterTurnMs':max(confirmed)-t['endMs'] if confirmed else None,'targetUpdates':updates,'nonappendRewrites':rewrites,'replacedChars':replacedChars,'blankAfterText':clears})
 summary={'firstVisibleMs':stats([x['firstVisibleMs'] for x in per if x['firstVisibleMs'] is not None]),'lastChangeAfterTurnMs':stats([x['lastChangeAfterTurnMs'] for x in per if x['lastChangeAfterTurnMs'] is not None]),'finalConfirmedAfterTurnMs':stats([x['finalConfirmedAfterTurnMs'] for x in per if x['finalConfirmedAfterTurnMs'] is not None]),'totalTargetUpdates':sum(x['targetUpdates'] for x in per),'totalNonappendRewrites':sum(x['nonappendRewrites'] for x in per),'turnsWithRewrite':sum(x['nonappendRewrites']>0 for x in per),'totalReplacedChars':sum(x['replacedChars'] for x in per),'totalBlanksAfterText':sum(x['blankAfterText'] for x in per),'turnRewrites':stats([x['nonappendRewrites'] for x in per])}
 out[arm]={'summary':summary,'turns':per};print(arm,json.dumps(summary))
(p/'live-report.json').write_text(json.dumps(out,indent=2))
