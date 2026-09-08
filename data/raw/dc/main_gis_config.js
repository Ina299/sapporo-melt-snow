//共通設定
const returningPage = 'map';
const domain = window.location.hostname;
const themeDirUrl = gisConfigData.themeDirUrl;

const photoGroups = [
    ['A001', 'A002', 'A003'],
    ['A006', 'A007'],
    ['A010', 'A011'],
    ['A026', 'A027'],
    ['A035', 'A036'],
    ['A047', 'A048'],
    ['A071', 'A072'],
    ['A077', 'A078'],
    ['A079', 'A080'],
];

// PHPから渡されたオプション設定を取得
const saved_mm_geojson_editor = gisConfigData.saved_mm_geojson_editor || {};
const currentGeoJsonFiles = saved_mm_geojson_editor.geojson_current || {};

// 冷房・暖房用のGeoJSONファイルパスを動的に設定
const geoJson_heating = currentGeoJsonFiles.heating ? `/wp-content/uploads/geojson/${currentGeoJsonFiles.heating}` : '';
const geoJson_cooling = currentGeoJsonFiles.cooling ? `/wp-content/uploads/geojson/${currentGeoJsonFiles.cooling}` : '';

const testDomain = saved_mm_geojson_editor.test_domain || '';
const googleMapIds = saved_mm_geojson_editor.google_map_id || {};

let googleMapCustomId = googleMapIds.prod || ''; // 本番環境用IDをデフォルトに設定
if (domain === testDomain) {
    // ドメインがテスト環境と一致する場合、テスト環境用IDで上書き
    googleMapCustomId = googleMapIds.test || '';
}

// 状態管理オブジェクト
const mapState = {
    // 内部状態
    _state: {
        mode: 'list', // 'list', 'detail', 'search', 'geojson-detail'
        visibleLayers: new Set(), // 表示中のレイヤーIDを管理
        zoomLevel: 0,
        isZoomOver13: false,
        isInitialGoogleFetchDone: false,
        currentDetail: {
            id: null,
            type: null,
            zoneId: null
        },
    },

    // モードを設定
    setMode(newMode) {
        this._state.mode = newMode;
        document.body.classList.remove('area-large', 'area-middle', 'area-detail', 'geojson-detail-view', 'mode-search');
        switch (newMode) {
            case 'list':
                document.body.classList.add('area-large');
                break;
            case 'search':
                document.body.classList.add('area-large', 'mode-search');
                break;
            case 'detail':
                document.body.classList.add('area-detail');
                break;
            case 'geojson-detail':
                document.body.classList.add('area-detail', 'geojson-detail-view');
                break;
        }
    },
    getMode() {
        return this._state.mode;
    },

    // レイヤーの表示/非表示を切り替え
    toggleLayer(layerId, isVisible) {
        if (isVisible) {
            this._state.visibleLayers.add(layerId);
        } else {
            this._state.visibleLayers.delete(layerId);
        }
        document.body.classList.toggle(`show-${layerId}`, isVisible);

        // 電力(elec)はサブレイヤーと連動
        if (layerId === 'elec') {
            this.toggleLayer('substation', isVisible);
            this.toggleLayer('lines', isVisible);
        }
    },
    isLayerVisible(layerId) {
        return this._state.visibleLayers.has(layerId);
    },

    // 詳細表示中の情報を設定
    setCurrentDetail(id, type, zoneId = null) {
        this._state.currentDetail = { id, type, zoneId };
    },
    getCurrentDetail() {
        return this._state.currentDetail;
    },
    clearCurrentDetail() {
        this._state.currentDetail = { id: null, type: null, zoneId: null };
    },

    // ズームレベル関連
    setZoom(zoom) {
        this._state.zoomLevel = zoom;
        const isOver13 = zoom > 13;
        if (this._state.isZoomOver13 !== isOver13) {
            this._state.isZoomOver13 = isOver13;
            document.body.classList.toggle('zoomOver13', isOver13);
        }
        document.getElementById('zoom-index').textContent = zoom;
    },
    isZoomOver(level) {
        return this._state.zoomLevel >= level;
    },
    
    // Google施設APIの初回取得フラグ
    setInitialGoogleFetchDone() {
        this._state.isInitialGoogleFetchDone = true;
    },
    isInitialGoogleFetchDone() {
        return this._state.isInitialGoogleFetchDone;
    }
};


let zoneStatus = {
    '分譲中': { 'slug': 'bunjochu', 'name': '分譲中', 'color': '#7dccf3' },
    '分譲済': { 'slug': 'bunjozumi', 'name': '分譲済', 'color': '#ed86b3' },
    '賃貸済': { 'slug': 'chintaizumi', 'name': '賃貸済', 'color': '#8d81bb' },
    'エリア用': { 'slug': 'area', 'name': 'エリア用', 'color': '#BB901B' },
}
const layerColors = {
  kogyo_danchi1: '#7DCCF3'
};
let substationSubName = {
  'SS': '変電所', 'SW': '開閉所', 'TP': '変電塔', 'CS': '変換所',
  'DP': '配電塔', 'SP': '開閉器柱',
}

let initLatLng = { lat: 43.493, lng: 142.614 };
let initZoom = 7;
const detailZoomLevel = 17;

const bounds = {
    north: 47.0, south: 40.0, east: 150.0, west: 135.0,
};

const mvColor = {
    0: 'rgba(102, 102, 102, 1)', // 要照会 #666666
    1: 'rgba(165, 168, 168, 1)', // 要照会 #a5a8a8
    2: 'rgba(165, 168, 168, 1)', // 0-4MW → 要照会扱い #a5a8a8
    3: 'rgba(191, 191, 255, 1)', // ~10MW #bfbfff
    4: 'rgba(179, 178, 255, 1)', // ~30MW #b3b2ff
    5: 'rgba(170, 153, 255, 1)', // ~50MW #aa99ff
    6: 'rgba(159, 140, 255, 1)', // ~100MW #9f8cff
    7: 'rgba(149, 128, 255, 1)', // ~300MW #9580ff
    8: 'rgba(178, 102, 255, 1)', // ~500MW #b266ff
    9: 'rgba(172, 89, 255, 1)',  // ~1000MW #ac59ff
    10: 'rgba(166, 77, 255, 1)',  // 1000MW #a64dff
}
const temperatureColorStops = [
  { temp: -30, color: '#7467ec' },
  { temp: -24, color: '#7d9cef' },
  { temp: -16, color: '#95cff2' },
  { temp:  -8, color: '#aeeff4' },
  { temp:  -1, color: '#c6f4e6' },
  // 0°C〜19°C は無色
  { temp:  20, color: '#e6f3d7' },
  { temp:  25, color: '#e7dbbb' },
  { temp:  30, color: '#e7b1a0' },
  { temp:  35, color: '#e78392' },
  { temp:  40, color: '#e867a7' },
];

//施設名
const placeTrans = {
    general_contractor: "総合建設業者", museum: "博物館", bank: "銀行", atm: "ATM", finance: "金融", store: "店舗", post_office: "郵便局",
    hair_care: "ヘアーサロン", home_goods_store: "生活雑貨店", grocery_or_supermarket: "食料品店", health: "ヘルスケア",
    real_estate_agency: "不動産屋", car_rental: "レンタカー屋", dentist: "歯医者", car_repair: "整備工場", car_dealer: "正規ディーラー",
    convenience_store: "コンビニエンスストア", police: "警察署", pharmacy: "薬局", local_government_office: "役所", city_hall: "公共施設",
    florist: "花屋", liquor_store: "酒屋", book_sotre: "本屋", accouting: "会計事務所", lawyer: "法律事務所", doctor: "整体",
    funeral_home: "斎場", church: "教会", gym: "ジム", electrician: "電気屋", night_club: "ナイトクラブ", bar: "バー",
    gas_station: "ガソリンスタンド", political: "行政区分", sublocality: "地域名", sublocality_level_2: "丁目", primary_school: "小学校",
    electronics_store: "家電量販店", travel_agency: "旅行代理店", clothing_store: "衣料品店", campground: "キャンプ場",
    school: "学校", place_of_worship: "礼拝施設", point_of_interest: "見どころ", food: "食事", establishment: "会社・店舗",
    electric_vehicle_charging_station: "EV充電スタンド", cultural_landmark: "文化的なランドマーク", historical_place: "歴史的な場所",
    monument: "記念碑", preschool: "幼稚園", university: "大学", banquet_hall: "宴会場", garden: "庭園",
    historical_landmark: "歴史的建造物", national_park: "国立公園", observation_deck: "展望デッキ", park: "公園",
    state_park: "州立公園", tourist_attraction: "観光施設", wildlife_park: "野生動物公園", wildlife_refuge: "野生動物保護区",
    asian_restaurant: "アジア料理店", bagel_shop: "ベーグルショップ", bakery: "ベーカリー", bar_and_grill: "バーアンドグリル",
    breakfast_restaurant: "朝食レストラン", brunch_restaurant: "ブランチレストラン", buffet_restaurant: "ビュッフェレストラン",
    cafe: "カフェ", cafeteria: "カフェテリア", chinese_restaurant: "中華料理店", coffee_shop: "コーヒーショップ", confectionery: "菓子店",
    deli: "食料品店", dessert_restaurant: "デザートレストラン", dessert_shop: "デザートショップ", diner: "夕食", donut_shop: "ドーナツショップ",
    fast_food_restaurant: "ファーストフード", fine_dining_restaurant: "高級レストラン", food_court: "フードコート",
    hamburger_restaurant: "ハンバーガー", italian_restaurant: "イタリア料理店", japanese_restaurant: "日本料理店",
    meal_delivery: "食事の宅配", meal_takeaway: "食事のテイクアウト", pizza_restaurant: "ピザレストラン", ramen_restaurant: "ラーメン店",
    restaurant: "レストラン", steak_house: "ステーキハウス", sushi_restaurant: "寿司レストラン", tea_house: "ティーハウス",
    wine_bar: "ワインバー", bed_and_breakfast: "ベッド＆ブレックファースト", budget_japanese_inn: "格安旅館",
    extended_stay_hotel: "長期滞在ホテル", hotel: "ホテル", inn: "旅館", japanese_inn: "日本の旅館", lodging: "宿泊施設",
    resort_hotel: "リゾートホテル", child_care_agency: "託児所", golf_course: "ゴルフコース", ski_resort: "スキー場", airport: "空港",
    airstrip: "飛行場", bus_station: "バス停", bus_stop: "バス停", ferry_terminal: "フェリーターミナル", international_airport: "国際空港",
    light_rail_station: "ライトレール駅", subway_station: "地下鉄駅", train_station: "電車駅", transit_depot: "交通機関の駅",
    transit_station: "交通機関の駅", truck_stop: "トラック停留所"
};

/**
 * 以下の関数を main_gis_test_temperature.js から移動
 */
function getRankOfMv(ordCur, crgCtrl) {
    if (ordCur == null || crgCtrl === 1 || crgCtrl === true) return 1;
    if (ordCur === 0) return 0;
    const ordCurNum = Number(ordCur);
    if (ordCurNum > 0 && ordCurNum <= 4) return 2;
    if (ordCurNum > 4 && ordCurNum <= 10) return 3;
    if (ordCurNum > 10 && ordCurNum <= 30) return 4;
    if (ordCurNum > 30 && ordCurNum <= 50) return 5;
    if (ordCurNum > 50 && ordCurNum <= 100) return 6;
    if (ordCurNum > 100 && ordCurNum <= 300) return 7;
    if (ordCurNum > 300 && ordCurNum <= 500) return 8;
    if (ordCurNum > 500 && ordCurNum < 1000) return 9;
    if (ordCurNum >= 1000) return 10;
    return 1; // Default
}

function getWidthOfVolt(volt) {
    const voltNum = Number(volt);
    if (voltNum <= 33 ) return 3;
    if (voltNum <= 66 ) return 4;
    if (voltNum <= 110 ) return 5;
    if (voltNum <= 187 ) return 7;
    if (voltNum <= 275 ) return 10;
    if (voltNum > 275 ) return 10;
    return 3; // Default
}

function getRankOfVolt(voltage) {
    const voltNum = Number(voltage);
    if (voltNum <= 66) return 0;
    if (voltNum > 66 && voltNum <= 110) return 1;
    if (voltNum > 110 && voltNum <= 187) return 2;
    if (voltNum > 187 && voltNum <= 275) return 3;
    return 0; // Default
}

function getTemperatureColor(value, type) {
    // 0°C〜19°Cは無色（透明）
    if (value >= 0 && value <= 19) return { color: '#000000', opacity: 0 };

    const stops = temperatureColorStops;

    // 上下端の範囲外はそのまま端の色を使用
    if (value <= stops[0].temp) return { color: stops[0].color, opacity: 0.8 };
    if (value >= stops[stops.length - 1].temp) return { color: stops[stops.length - 1].color, opacity: 0.8 };

    // 無色帯（0〜19°C）をまたぐ補間を避けるため、冷房側・暖房側で分離して探索
    // value < 0 → 暖房側ストップ（temp <= -1）、value >= 20 → 冷房側ストップ（temp >= 20）
    let start, end;
    for (let i = 1; i < stops.length; i++) {
        if (value <= stops[i].temp) {
            start = stops[i - 1];
            end = stops[i];
            break;
        }
    }

    const range = end.temp - start.temp;
    if (range === 0) return { color: start.color, opacity: 0.8 };

    const t = (value - start.temp) / range;
    const c1 = hexToRgb(start.color);
    const c2 = hexToRgb(end.color);
    const r = Math.round(c1.r + (c2.r - c1.r) * t);
    const g = Math.round(c1.g + (c2.g - c1.g) * t);
    const b = Math.round(c1.b + (c2.b - c1.b) * t);

    return { color: rgbToHex(r, g, b), opacity: 0.8 };
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
}

function rgbToHex(r, g, b) {
    const clamp = (val) => Math.max(0, Math.min(255, val));
    return "#" + [clamp(r), clamp(g), clamp(b)].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * 送電線の空容量ランクに対応するテキスト
 */
const textForOrdCurRank = ["要照会", "要照会", "要照会", "5～9MW", "10～29MW", "30～49MW", "50～99MW", "100～299MW", "300～499MW", "500～ MW", "1000～ MW"];

/**
 * GeoJSONのフィーチャオブジェクトから、その種別を判定するヘルパー関数。
 * @param {google.maps.Data.Feature} feature - 地図のフィーチャオブジェクト
 * @returns {string} - 'substation', 'line', 'kogyo_danchi1', 'est_zone', 'cooling', 'heating', 'unknown' のいずれかの文字列
 */
function determineFeatureType(feature) {
    const dataType = feature.getProperty('dataType');
    if (dataType) {
        return dataType;
    }
    if (!!feature.getProperty('estid')) {
        return 'est_zone';
    }
    if (!!feature.getProperty('L05_002')) {
        return 'kogyo_danchi1';
    }
    if (!!feature.getProperty('変電所名')) {
        return 'substation';
    }
    // ここを修正します：
    // PowerLineプロパティとジオメトリタイプからlinesを判定
    if (!!feature.getProperty('PowerLine') && feature.getGeometry().getType().includes('LineString')) {
        return 'lines';
    }
    // ★追加: Lite版GeoJSONの特徴（路線名がある）で判定
    if (feature.getProperty('路線名')) {
        return 'photo';
    }
    return 'unknown';
}
