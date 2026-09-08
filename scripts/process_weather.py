import hashlib
import json
from datetime import datetime, timezone
import pandas as pd
from build_inventory import ROOT,save

def main():
    sources=json.loads((ROOT/'data/sources.json').read_text(encoding='utf-8'))
    stats={};daily=[]
    for kind,stem in [('snowfall','snowfall_r08_0411'),('snowdepth','snowdepth_r08_0411')]:
        path=ROOT/f'data/raw/{kind}_2025.xls'
        url=f'https://www.city.sapporo.jp/kensetsu/yuki/documents/{stem}.xls'
        df=pd.read_excel(path,header=4)
        stations=list(df.columns[3:])
        for _,row in df.iterrows():
            date=f'{int(row.iloc[0]):04d}-{int(row.iloc[1]):02d}-{int(row.iloc[2]):02d}'
            for station in stations:
                raw=row[station]
                v=pd.to_numeric(raw,errors='coerce')
                daily.append(dict(date=date,station=station,kind=kind,value_cm=None if pd.isna(v) else float(v),
                                  quality='missing' if pd.isna(v) else 'published; reference periods in source notes',source_url=url))
        for station in stations:
            v=pd.to_numeric(df[station],errors='coerce')
            stats.setdefault(station,dict(station=station))
            stats[station].update({kind+'_max_cm':float(v.max()),kind+'_missing_days':int(v.isna().sum())})
            if kind=='snowfall':
                stats[station].update(snowfall_sum_cm=float(v.sum()),days_over_10cm=int((v>10).sum()),
                    p95_cm=float(v.quantile(.95)),peak_date=daily[0]['date'] if v.empty else
                    f'{int(df.loc[v.idxmax()].iloc[0]):04d}-{int(df.loc[v.idxmax()].iloc[1]):02d}-{int(df.loc[v.idxmax()].iloc[2]):02d}')
        sources=[r for r in sources if r['id']!=kind+'_2025']
        sources.append(dict(id=kind+'_2025',url=url,retrieved_at=datetime.now(timezone.utc).isoformat(),
            path=str(path.relative_to(ROOT)),sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
            source_as_of='2026-04-11',period='2025-11-01 / 2026-04-10'))
    save('weather_daily',daily)
    summary=dict(period='2025-11-01〜2026-04-10',source_url='https://www.city.sapporo.jp/kensetsu/yuki/weather-data.html',
        notes='降雪量は朝9時までの24時間値。2025/11/1–13と白石区2026/3/9–25にセンサー休止による参考値を含む。Xは欠測。日量10cm超の日数は出動回数ではない。',
        stations=list(stats.values()))
    (ROOT/'data/processed/weather_summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    (ROOT/'data/sources.json').write_text(json.dumps(sources,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=True))

if __name__=='__main__':main()
