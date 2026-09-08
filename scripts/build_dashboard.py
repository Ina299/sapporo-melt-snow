"""Build the current dashboard bundle without archived pilot roads/scenarios."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def main():
    from build_snow_management import main as build_snow
    build_snow()
    data={}
    for name in ['contractors','candidates','district_fleet','contractor_directory']:
        data[name]=json.loads((ROOT/f'data/processed/{name}.json').read_text(encoding='utf-8'))
    for key,path in [('sources','data/sources.json'),('weather','data/processed/weather_summary.json'),('dc','data/processed/dc_feasibility.json')]:
        data[key]=json.loads((ROOT/path).read_text(encoding='utf-8'))
    (ROOT/'web/data.js').write_text('window.SAPPORO_DATA = '+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';',encoding='utf-8')
if __name__=='__main__':main()
