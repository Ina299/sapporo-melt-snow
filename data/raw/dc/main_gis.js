//共通設定
let googleMap;
let markers = [];
window.openPopups = [];
window.linePopup = null;

/**
 * 静的ファイル配信化された GeoJSON データ・検索データを並列 fetch で取得し、
 * window.transientGeoJSONs / window.geoSearchData にセットする。
 *
 * - mmGeneratedDataManifest: PHP から渡される { baseUrl, manifestUrl, version, excludeMapKeys }
 * - manifest.json: { version, map: [...], search: [...] }
 *
 * map データはフロントが期待する FeatureCollection 形式に正規化する
 * （プラグインは features 配列 / FeatureCollection / Point配列 など key により異なる形式で書き出すため）
 */
window.loadGeneratedData = async function () {
    if (typeof mmGeneratedDataManifest === 'undefined') {
        console.warn('mmGeneratedDataManifest is not defined; skipping data load');
        window.transientGeoJSONs = {};
        window.geoSearchData = {};
        return;
    }
    const { baseUrl, manifestUrl, version, excludeMapKeys = [] } = mmGeneratedDataManifest;
    const v = version ? `?v=${encodeURIComponent(version)}` : '';

    // 1. manifest を取得
    let manifest;
    try {
        const res = await fetch(manifestUrl + v);
        if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
        manifest = await res.json();
    } catch (e) {
        console.error('Failed to load generated/manifest.json:', e);
        window.transientGeoJSONs = {};
        window.geoSearchData = {};
        return;
    }

    const mapKeys    = (manifest.map    || []).filter(k => !excludeMapKeys.includes(k));
    const searchKeys = (manifest.search || []);

    // FeatureCollection 形式に正規化
    const toFC = (data) => {
        if (data && typeof data === 'object' && data.type === 'FeatureCollection') return data;
        if (Array.isArray(data)) return { type: 'FeatureCollection', features: data };
        return { type: 'FeatureCollection', features: [] };
    };

    // 2. map データと search データを並列 fetch
    const fetchOne = (key) =>
        fetch(`${baseUrl}${key}.json${v}`)
            .then(r => { if (!r.ok) throw new Error(`${key} HTTP ${r.status}`); return r.json(); })
            .catch(e => { console.error(`Failed to load ${key}.json:`, e); return null; });

    const [mapResults, searchResults] = await Promise.all([
        Promise.all(mapKeys.map(k => fetchOne(k).then(d => [k, d]))),
        Promise.all(searchKeys.map(k => fetchOne(`search_${k}`).then(d => [k + '_all', d]))),
    ]);

    const transientGeoJSONs = {};
    for (const [key, data] of mapResults) {
        if (data === null) continue;
        transientGeoJSONs[key] = toFC(data);
    }

    const geoSearchData = {};
    for (const [key, data] of searchResults) {
        if (data === null) continue;
        geoSearchData[key] = data;
    }

    window.transientGeoJSONs = transientGeoJSONs;
    window.geoSearchData = geoSearchData;
};
globalThis.recordMap = [];
globalThis.recordMapNow = 0;
globalThis.recordable = true;
const tgtTypeList = ['town','koji_info','est'];
const elecTypeList = ['substation','lines','kogyo_danchi']
let mapLayers = {
    koji_info: [],
    est: [],
    town: [],
    lines_lv0: [],
    lines_lv1: [],
    lines_lv2: [],
    kogyo_danchi1: [],
    search: [],
    default: [],
    google: {
        g1: [], g2: [], g3: [], g4: [], g5: [], g6: [], g7: [],
    },
};
let markerClusters = {};
let isLayerShown = {
    koji_info: false,
    est: true,
    town: false,
    lines: true,
    substation: true,
    kogyo_danchi1: true,
    upc: true,
    cooling: false,
    heating: false,
    search: false,
    default: false,
    google: {
        g1: false, g2: true, g3: true, g4: false, g5: false, g6: false, g7: false,
    },
};
let isLayerShownGoogleNum = 0;
let isZoomOver13 = false;
let isZoomOver10 = false;
let isZoomOver8 = false;
let isInitShisetsu = true;
let persistentSearchResult = {};
let searchResultKeeper = {
    koji_info: [],
    est: [],
    town: [],
};
let isGeoJsonDetailView = false;
let detailGeoJsonInfo = null;
let isMarkerHovering = false;
let currentViewingMarkerId = null;
let currentPopupLatLng = null;
let lastGoogleApiFetchCenter = null;
let isDetailViewTransitioning = false;
let highlightedFeature = null;
window.isHoveringSubstation = false;
let hasPerformedInitialGoogleFetch = false;
window.isHoveringEstZone = false;
let mouseoutTimeout = null;

//施設マーカー
const googleKinds = ['g1','g2','g3','g4','g5','g6','g7'];
let isFirstNearby = true;
let resultGoogleNum = 0;

//data
var dataAllJson = {
    koji_info: {},
    est: {},
    town: {},
};
var dataAll = {
    koji_info: {},
    est: {},
    town: {},
};
var selectedMarker = null;
var searchedIds = [];
var mapPageInfo = {};
const slideOption = {
    dots: true,
    arrows: false,
    infinite: true,
    speed: 300,
    swipe: true,
    swipeToSlide: true,
    adaptiveHeight: true,
    variableWidth: true
};

const mappinInfo = {
    koji_info: {
        single: {img: 'icon_mappin_shop.svg',width: 26,height: 32,},
        selected: {img: 'icon_mappin_shop_red.svg',width: 26,height: 32,},
        cluster: {img: 'icon_mappin_shop_with_badge.svg',width: 34,height: 40,},
    },
    est: {
        single: {img: 'icon_mappin_est.svg',width: 26,height: 32,},
        selected: {img: 'icon_mappin_est_red.svg',width: 26,height: 32,},
        cluster: {img: 'icon_mappin_est_with_badge.svg',width: 34,height: 40,},
    },
    town: {
        single: {img: 'icon_mappin_needle_red.svg',width: 10,height: 25,},
        selected: {img: 'icon_mappin_needle_red.svg',width: 10,height: 25,},
        cluster: {img: 'icon_mappin_needle_red.svg',width: 10,height: 25,},
    },
    photo: {
        single: {img: 'icon_mappin_photo.svg',width: 26,height: 32,},
        selected: {img: 'icon_mappin_photo_red.svg',width: 26,height: 32,},
        cluster: {img: 'icon_mappin_photo_with_badge.svg',width: 34,height: 40,},
    },
}

jQuery(function ($) {
    //ドロワー:画像スライダー
    if (jQuery('#est-gallery').length) {
        jQuery('#est-gallery ul').slick(slideOption);
    }
    if (jQuery('#town-gallery').length) {
        jQuery('#town-gallery ul').slick(slideOption);
    }

    //無段階スクロール（横）
    document.querySelectorAll('.scroll-container').forEach(scrollContainer => {
        let isDown = false;
        let startX;
        let scrollLeft;
        scrollContainer.addEventListener('mousedown', (e) => {
            isDown = true;
            scrollContainer.classList.add('active');
            startX = e.pageX - scrollContainer.offsetLeft;
            scrollLeft = scrollContainer.scrollLeft;
        });
        scrollContainer.addEventListener('mouseleave', () => {
            isDown = false;
            scrollContainer.classList.remove('active');
        });
        scrollContainer.addEventListener('mouseup', () => {
            isDown = false;
            scrollContainer.classList.remove('active');
        });
        scrollContainer.addEventListener('mousemove', (e) => {
            if (!isDown) return;
            e.preventDefault();
            const x = e.pageX - scrollContainer.offsetLeft;
            const walk = (x - startX) * 3; // スクロール速度を調整
            scrollContainer.scrollLeft = scrollLeft - walk;
        });
    });

    //無段階スクロール（縦）
    if (jQuery('.scroll-container-y').length) {
        const scrollContainerY = document.querySelectorAll('.scroll-container-y');
        let isDown = false;
        let startY;
        let scrollTop;
        scrollContainerY.forEach(function(element) {
            element.addEventListener('mousedown', (e) => {
                isDown = true;
                element.classList.add('active');
                startY = e.pageY - element.offsetTop;
                scrollTop = element.scrollTop;
                document.body.style.userSelect = 'none';
            });
            element.addEventListener('mouseleave', () => {
                isDown = false;
                element.classList.remove('active');
                document.body.style.userSelect = '';
            });
            element.addEventListener('mouseup', () => {
                isDown = false;
                element.classList.remove('active');
                document.body.style.userSelect = '';
            });
            element.addEventListener('mousemove', (e) => {
                if (!isDown) return;
                e.preventDefault();
                const y = e.pageY - element.offsetTop;
                const walk = (y - startY) * 3; // スクロール速度を調整
                element.scrollTop = scrollTop - walk;
            });
        });
    }

    // ズーム（独自パーツ）
    if (jQuery('#zoomIn').length) {
        document.getElementById("zoomIn").addEventListener("click", function () {
            const currentZoom = googleMap.getZoom();
            googleMap.setZoom(currentZoom + 1);
        });
        document.getElementById("zoomOut").addEventListener("click", function () {
            const currentZoom = googleMap.getZoom();
            googleMap.setZoom(currentZoom - 1);
        });
    }

    //ドロワー開閉・戻る
    jQuery('#dwh-handle').on('click', function() {
        toggleDrawer();
    });
    jQuery(document).on('click','#dwh-back', function() {
        if (jQuery('body').hasClass('has-record')) {
            backToRecordMap();
        } else {
            toggleDrawer();
        }
    });

    //ドロワーからクリックで単独表示
    jQuery(document).on('click', '#for-point li', function() {
        if (jQuery(this).attr('data-click') == 'disable') {
            return false;
        }
        const id = jQuery(this).attr('data-id');
        const type = jQuery(this).attr('data-type');
        const currentMode = mapState.getMode();
        // 検索モード中で、かつクリックされたのがGeoJSON系のリストの場合
        if ((currentMode === 'search' || currentMode === 'geojson-detail') && ['substation', 'lines', 'kogyo_danchi1', 'upc'].includes(type)) {
            goDetailForGeoJson(id, type);
        }

        // 写真リストの場合（lat/lonがdata属性にないため、GeoJSONから取得）
        else if (type === 'photo') {
            let targetLat = 0;
            let targetLon = 0;
            if (typeof transientGeoJSONs !== 'undefined' && transientGeoJSONs['photo_tetto_lite']) {
                let features = transientGeoJSONs['photo_tetto_lite'].features;
                if (!Array.isArray(features) && typeof features === 'object') features = Object.values(features);
                const feature = features.find(f => String(f.id || f.properties.id) === String(id));
                if (feature && feature.geometry && feature.geometry.coordinates) {
                    targetLon = feature.geometry.coordinates[0];
                    targetLat = feature.geometry.coordinates[1];
                }
            }
            if (targetLat !== 0 && targetLon !== 0) {
                goDetail(id, type, targetLat, targetLon);
            }
        }

        // 上記以外のカスタム投稿（koji_info, est, town）の場合
        else if (['koji_info', 'est', 'town'].includes(type)) {
            const lat = jQuery(this).attr('data-lat');
            const lon = jQuery(this).attr('data-lon');
            const zoneId = jQuery(this).attr('data-zone-id'); // zoneIdを取得
            goDetail(id, type, parseFloat(lat), parseFloat(lon), zoneId);
        }
    });

    //HOMEに戻る
    jQuery('.ph-home').on('click',function(){
        location.href = '/';
    })

    //地図検索
    jQuery('#mapsearch-go').on('click', function(){
        if (!jQuery('#mapsearch').val()) {
            location.href = '/' + returningPage;
        } else {
            plotMarkerBySearch(jQuery('#mapsearch').val());
        }
    });

    //地図検索クリア
    jQuery('#mapsearch-clear').on('click', function(){
        if (jQuery('#mapsearch').val()) {
            jQuery('#mapsearch').val('');
            jQuery('body').removeClass('with-word no-search-result');
            endModeSearch();
        }
    });

    //地図検索欄の状態をリアルタイムで検知
    document.getElementById('mapsearch').addEventListener('input', function(event) {
        if (event.target.value != '') {
            jQuery('body').addClass('with-word');
        } else {
            jQuery('body').removeClass('with-word');
        };
    });

    //入力欄でエンターが押された場合も検索
    document.getElementById("mapsearch").addEventListener("keydown", function(event) {
        if (event.key === "Enter") {
            event.preventDefault();
            if (jQuery('#mapsearch').val() == '') {
                return false;
            } else {
                plotMarkerBySearch(jQuery('#mapsearch').val());
            }
        }
    });

    // 周辺情報取得
    jQuery('#google-areasearch').on('click', function(){
        updateGoogleLayer('area', 0, 0, true, true);
    });

    // 写真ポップアップ関連のイベント設定
    $('#photo-popup-overlay .close-btn').on('click', function() {
        closePhotoPopup();
    });
    $('#photo-popup-overlay').on('click', function(e) {
        if (e.target === this || $(e.target).hasClass('popup-content')) {
            closePhotoPopup();
        }
    });

    // レイヤー切替
    jQuery('.mapbtn-unit button').on('click', function() {
        if (window.temperaturePopup) window.temperaturePopup.hide();
        var tgt = jQuery(this).attr('data-tgt');
        if (tgt == 'elec') {
            if (jQuery('body').hasClass('show-elec')) {
                jQuery('body').removeClass('show-elec');
                changeLayer('substation', false);
                changeLayer('lines', false);
                changeLayer('upc', false);
            } else {
                jQuery('body').addClass('show-elec');
                changeLayer('substation', true);
                changeLayer('lines', true);
                changeLayer('upc', true);
            }
            } else if (tgt === 'cooling') {
            const show = !jQuery('body').hasClass('show-cooling');
            // もし冷房をONにする際、暖房がONだったらOFFにする
            if (show && jQuery('body').hasClass('show-heating')) {
                changeLayer('heating', false);
            }
            changeLayer('cooling', show);
        } else if (tgt === 'heating') {
            const show = !jQuery('body').hasClass('show-heating');
            // もし暖房をONにする際、冷房がONだったらOFFにする
            if (show && jQuery('body').hasClass('show-cooling')) {
                changeLayer('cooling', false);
            }
            changeLayer('heating', show);
        } else if (jQuery(this).hasClass('google_sw')) {
            const kind = jQuery(this).attr('data-tgt');
            const show = !mapState.isLayerVisible(kind);
            // 課題のある独自実装をやめ、既存の正しい関数を呼び出す
            changeLayer(kind, show);
        } else {
            if (jQuery('body').hasClass('show-' + tgt)) {
                changeLayer(tgt, false);
            } else {
                changeLayer(tgt, true);
            }
        }
        var isLayerShownGoogleNum = 0;
        googleKinds.forEach((kind) => {
            if (jQuery('body').hasClass('show-' + kind)) {
                isLayerShownGoogleNum++;
            }
        })
        if (isLayerShownGoogleNum == 0) {
            jQuery('body').addClass('google-off-all');
        } else {
            jQuery('body').removeClass('google-off-all');
        }
        var currentCode = '';
        jQuery('.mapbtn-unit button').each(function(){
            var $button = jQuery(this);
            // Google施設ボタンは除外
            if ($button.hasClass('google_sw')) {
                return;
            }
            // 対応するレイヤーが表示されているかbodyのクラスで判定
            if (jQuery('body').hasClass('show-' + $button.attr('data-tgt'))) {
                // ボタンが data-code 属性を持っていればコードを追加
                if ($button.attr('data-code')) {
                    currentCode += $button.attr('data-code');
                }
            }
        });
        // 生成したコードの文字をアルファベット順にソートして、デフォルト状態か判定しやすくする
        const sortedCode = currentCode.split('').sort().join('');
        var url = new URL(window.location);

        // デフォルト状態（電力 s, 用地 e, 工業団地 y -> ソート後 'esy'）の場合、URLパラメータを削除
        if (sortedCode === 'esy') {
            url.search = ''; // パラメータ全体をクリア
        } else {
            // デフォルトでない場合は、vパラメータを現在の状態に設定
            url.searchParams.set('v', currentCode);
        }
        
        // URLを書き換える
        history.replaceState(null, '', url);

        if (mapState.getMode() === 'search' && jQuery('#mapsearch').val()) {
            plotMarkerBySearch(jQuery('#mapsearch').val());
            if (window.innerWidth <= 768) {
                const drawer = document.getElementById('mapDrawer');
                const computedTop = window.getComputedStyle(drawer).top;
                const topValue = parseFloat(computedTop);
                jQuery('.dw-body-wrap').css('height','calc(' + Math.abs(topValue) + 'px - 60px)');
            }
        }
        updateNoResultMessage();
    });

    //免責事項開閉
    jQuery('.dc-trigger').on('click', function(){
        var hdc = jQuery('#disclaimer .dc-body > div').innerHeight();
        var hwrap = jQuery('#disclaimer-wrap').innerHeight();
        var long = (hwrap / hdc) * 100;
        jQuery('#disclaimer').css('height', hdc + 'px');
        jQuery('.dc-scbar span').css('height', long + '%');
        if (long > 100) {
            jQuery('.dc-scbar').css('display', 'none');
        } else {
            jQuery('.dc-scbar').css('display', 'inline-block');
        }
        if (jQuery('body').hasClass('dc-stay')) {
            mapPageInfo['drawerOpening'] = [];
            if (!jQuery('body').hasClass('stay')) {mapPageInfo['drawerOpening'].push('stay');}
            if (!jQuery('body').hasClass('hp-stay')) {mapPageInfo['drawerOpening'].push('hp-stay');}
            if (!jQuery('body').hasClass('gd-stay')) {mapPageInfo['drawerOpening'].push('gd-stay');}
            jQuery('body').addClass('stay hp-stay gd-stay').removeClass('dc-stay');
        } else {
            dcClose();
        }
    })
    jQuery('.dc-close').on('click', function(){
        dcClose();
    })

    //電話モーダルを開く（ボタン,detail）
    jQuery(document).on('click','#detail-contact .for-phone, #for-detail-koji_info .shop-phone a', function(e){
        e.preventDefault();
        var companyName = jQuery('#for-detail-koji_info .shop-name').text();
        var companyPhone = jQuery('#for-detail-koji_info .shop-phone a').text();
        setModalPhone (companyName, companyPhone);
        jQuery('body').addClass('show-modal-tel');
        return false;
    })
    //電話モーダルを開く（ドロワー一覧）
    jQuery(document).on('click','#detail-contact .for-phone', function(e){
        e.preventDefault();
        var companyName = jQuery('#for-detail-koji_info .shop-name').text();
        var companyPhone = jQuery('#for-detail-koji_info .shop-phone a').text();
        setModalPhone (companyName, companyPhone);
        jQuery('body').addClass('show-modal-tel');
        return false;
    })

    //電話モーダルを閉じる
    jQuery(document).on('click','#detail-modal .for-cancel', function(e){
        e.preventDefault();
        jQuery('body').removeClass('show-modal-tel');
        return false;
    })
    jQuery(document).on('click','#detail-modal-wrap', function(e){
        if (!jQuery(e.target).closest('#detail-modal').length) {
            jQuery('body').removeClass('show-modal-tel');
        }
    })

    //estドロワーのアコーディオン
    jQuery(document).on('click', '.est-block[data-close] .est-title', function() {
        var tgtDiv = jQuery(this).closest('.est-block');
        tgtDiv.toggleClass('is-closed');
        saveEstAccordionState();
    });
});

jQuery(function($) {

        $('body').addClass('show-googlemap show-g2 show-g3');

        if (isSingle()) {
            $('#google-areasearch').prop('disabled', true).css({
                'opacity': '0.5',
                'cursor': 'not-allowed'
            });
        }

        const scrollContainer = document.querySelector('.dc-body.scroll-container-y');
        if (scrollContainer) {
            scrollContainer.addEventListener('scroll', () => {
                const scrollTop = scrollContainer.scrollTop;
                var hdc = $('#disclaimer .dc-body > div').innerHeight();
                var btop = (scrollTop / hdc) * 100;
                $('.dc-scbar span').css('top', btop + '%');
            });
        }

        const mapTooltip = initializeMapTooltip();

        if (isPageWithMap()) {
          // 静的ファイルから geoJSON / 検索データを並列 fetch してから初期化を実行
          (async () => {
            try {
                await loadGeneratedData();
            } catch (e) {
                console.error('loadGeneratedData failed:', e);
            }

            dataAll.koji_info = mapInitialData.koji_info || {};
            dataAll.est = mapInitialData.est || {};
            dataAll.town = mapInitialData.town || {};

            generateDrawerList();

            initGoogleMap();

            // Google施設の初期表示状態をmapStateに同期させる
            googleKinds.forEach(kind => {
                if (document.body.classList.contains(`show-${kind}`)) {
                    mapState.toggleLayer(kind, true);
                }
            });

            window.temperaturePopup = new CustomTemperaturePopup(googleMap);
            window.substationPopup = new CustomPointPopup(googleMap);
            window.polygonPopup = new CustomPolygonPopup(googleMap, { "L05_002": "" });
            window.linePopup = new CustomLinePopup(googleMap);

            // 工業団地ホバー処理（mousemoveを利用）
            let hoveredDanchiFeatureId = null;
    
            googleMap.addListener('mousemove', function(e) {
                // 工業団地レイヤーが非表示、または検索モードでなければ処理しない
                if (!mapState.isLayerVisible('kogyo_danchi1') || mapState.getMode() === 'search') {
                    if (hoveredDanchiFeatureId !== null) {
                        window.polygonPopup?.hidePopup();
                        hoveredDanchiFeatureId = null;
                    }
                    return;
                }
    
                let foundFeature = null;
                // 地図上の地物を総当たりでチェック（パフォーマンスより確実性を優先）
                googleMap.data.forEach(feature => {
                    if (foundFeature) return; // 既に見つかったらループを抜ける
                    if (feature.getProperty('L05_002')) { // 工業団地の地物かチェック
                        const geometry = feature.getGeometry();
                        if (!geometry) return;
                        let isInside = false;
                        const type = geometry.getType();
    
                        if (type === 'Polygon') {
                            const tempPolygon = new google.maps.Polygon({ paths: geometry.getArray().map(ring => ring.getArray()) });
                            if (google.maps.geometry.poly.containsLocation(e.latLng, tempPolygon)) isInside = true;
                        } else if (type === 'MultiPolygon') {
                            for (const polygonData of geometry.getArray()) {
                                const tempPolygon = new google.maps.Polygon({ paths: polygonData.getArray().map(ring => ring.getArray()) });
                                if (google.maps.geometry.poly.containsLocation(e.latLng, tempPolygon)) {
                                    isInside = true;
                                    break;
                                }
                            }
                        }
                        if (isInside) foundFeature = feature;
                    }
                });
    
                if (foundFeature) {
                    const featureId = foundFeature.getId();
                    // 新しいポリゴンにホバーした場合のみポップアップを更新
                    if (hoveredDanchiFeatureId !== featureId) {
                        hoveredDanchiFeatureId = featureId;
                        const name = foundFeature.getProperty('L05_002') || "不明";
                        window.polygonPopup.div.querySelector('.polygon-info').textContent = name;
                        window.polygonPopup.updatePosition(e.latLng); // マウス位置に追従
                        window.polygonPopup.showPopup();
                    }
                } else {
                    // どのポリゴンにも乗っていない場合、ポップアップを隠す
                    if (hoveredDanchiFeatureId !== null) {
                        hoveredDanchiFeatureId = null;
                        window.polygonPopup.hidePopup();
                    }
                }
            });

            googleMap.addListener("click", (e) => {
                let foundPolygon = false;
                const activeTempLayer = mapState.isLayerVisible('cooling') ? 'cooling' : (mapState.isLayerVisible('heating') ? 'heating' : null);

                if (activeTempLayer) {
                    const features = [];
                    googleMap.data.forEach(feature => features.push(feature));

                    for (let i = features.length - 1; i >= 0; i--) {
                        const feature = features[i];
                        if (feature.getProperty('dataType') === activeTempLayer) {
                            const geometry = feature.getGeometry();
                            if (!geometry) continue;

                            const geometryType = geometry.getType();
                            let isInside = false;

                            if (geometryType === 'Polygon') {
                                const tempPolygon = new google.maps.Polygon({ paths: geometry.getArray().map(ring => ring.getArray()) });
                                if (google.maps.geometry.poly.containsLocation(e.latLng, tempPolygon)) {
                                    isInside = true;
                                }
                            } else if (geometryType === 'MultiPolygon') {
                                const polygons = geometry.getArray();
                                for (const dataPolygon of polygons) {
                                    const tempPolygon = new google.maps.Polygon({ paths: dataPolygon.getArray() });
                                    if (google.maps.geometry.poly.containsLocation(e.latLng, tempPolygon)) {
                                        isInside = true;
                                        break;
                                    }
                                }
                            }

                            if (isInside) {
                                const typeName = activeTempLayer === 'cooling' ? '冷房' : '暖房';
                                const value = activeTempLayer === 'cooling'
                                    ? feature.getProperty('ELEV_min')
                                    : feature.getProperty('Th100_min');
                                
                                if (typeof value === 'number') {
                                    const content = `設計外気温（${typeName}）: ${value.toFixed(1)}℃`;
                                    window.temperaturePopup.show(e.latLng, content);
                                }
                                foundPolygon = true;
                                break;
                            }
                        }
                    }
                }

                if (foundPolygon) {
                    return;
                }

                if (window.linePopup) window.linePopup.hide();
                if (window.substationPopup) window.substationPopup.hidePopup();
                if (window.polygonPopup) window.polygonPopup.hidePopup();
                if (window.temperaturePopup) window.temperaturePopup.hide();
            });

            googleMap.addListener("dragstart", () => {
                if (window.linePopup) window.linePopup.hide();
                if (window.substationPopup) window.substationPopup.hidePopup();
                if (window.polygonPopup) window.polygonPopup.hidePopup();
                if (window.temperaturePopup) window.temperaturePopup.hide();
            });
            googleMap.addListener("zoom_changed", () => {
                if (window.linePopup) window.linePopup.hide();
                if (window.substationPopup) window.substationPopup.hidePopup();
                if (window.polygonPopup) window.polygonPopup.hidePopup();
                if (window.temperaturePopup) window.temperaturePopup.hide();
                doWhenZoomChanged();
            });

            googleMap.data.addListener('click', function(event) {
                const feature = event.feature;
                
                if (feature.getProperty('estid')) {
                    const estid = feature.getProperty('estid');
                    const zoneid = feature.getProperty('zoneid');
                    
                    let targetLat, targetLng;
                    const pinLat = parseFloat(feature.getProperty('pin_lat'));
                    const pinLon = parseFloat(feature.getProperty('pin_lon'));

                    if (!isNaN(pinLat) && !isNaN(pinLon) && pinLat !== 0 && pinLon !== 0) {
                        targetLat = pinLat;
                        targetLng = pinLon;
                    } else {
                        const bounds = new google.maps.LatLngBounds();
                        feature.getGeometry().forEachLatLng(latlng => bounds.extend(latlng));
                        const centerLatLng = bounds.getCenter();
                        targetLat = centerLatLng.lat();
                        targetLng = centerLatLng.lng();
                    }
                    
                    goDetail(estid, 'est', targetLat, targetLng, zoneid);
                    return; 
                }

                if (mapState.getMode() === 'search') {
                    const featureId = String(feature.getId());
                    const dataType = feature.getProperty('dataType');

                    if (dataType === 'substation') {
                        goDetailForGeoJson(featureId, 'substation');
                        return;
                    } else if (feature.getProperty('L05_002')) {
                        goDetailForGeoJson(featureId, 'kogyo_danchi1');
                        return;
                    }
                }
            });

            googleMap.data.addListener('mouseover', function(event) {
                const feature = event.feature;
                const dataType = feature.getProperty('dataType');

                // --- 優先度1: 変電所 ---
                if (dataType === 'substation') {
                    window.isHoveringSubstation = true; // フラグを設定
                    window.linePopup?.hide(); // lineのポップアップがもし表示されていれば隠す
                    
                    const properties = {};
                    feature.forEachProperty((value, key) => { properties[key] = value; });
                    const centerLatLng = feature.getGeometry().get(); 
                    substationPopup.setContent(properties);
                    substationPopup.updatePosition(centerLatLng); 
                    substationPopup.showPopup();
                    return; 
                }

                // --- 優先度2: 送電線 (変電所にホバーしていない場合のみ) ---
                if (dataType === 'lines' || dataType === 'upc') {
                    // 変電所のフラグが立っている場合は何もしない
                    if (window.isHoveringSubstation) {
                        return;
                    }
                    
                    const properties = {};
                    feature.forEachProperty((value, key) => { properties[key] = value; });
                    window.linePopup.show(event.latLng, properties);
                    return;
                }

                // --- 優先度3: 用地（est）ゾーン ---
                if (feature.getProperty('estid')) {
                    window.isHoveringEstZone = true;
                    const estid = feature.getProperty('estid');
                    const zoneid = feature.getProperty('zoneid');
                    const pointData = dataAll.est[estid];
                    if (pointData && pointData.name) {
                        let tooltipText = pointData.name;
                        const allZoneData = JSON.parse(pointData.zone_data || '{}');
                        const specificZoneInfo = (zoneid !== null && allZoneData[zoneid]) ? allZoneData[zoneid] : null;
                        if (specificZoneInfo && specificZoneInfo.name) {
                            tooltipText += ` - ${specificZoneInfo.name}`;
                        }
                        mapTooltip.innerHTML = tooltipText;
                        mapTooltip.style.display = 'block';
                    }
                    return;
                }
            });

            googleMap.data.addListener('mouseout', function(event) {
                const feature = event.feature;
                const dataType = feature.getProperty('dataType');
                
                // mouseoutでフラグを解除し、ポップアップやツールチップを非表示にする
                if (dataType === 'substation') {
                    window.isHoveringSubstation = false;
                    substationPopup.hidePopup();
                } else if (dataType === 'lines' || dataType === 'upc') {
                    window.linePopup?.hide();
                } else if (feature.getProperty('estid')) {
                    window.isHoveringEstZone = false;
                    mapTooltip.style.display = 'none';
                    mapTooltip.innerHTML = '';
                }
            });

            googleMap.addListener('idle', handleMapIdle);

            if ($('body').hasClass('single-koji_info')) {
                const koji_infoId = String(mapInitialData.current_post_id);
                const data = dataAll['koji_info'][koji_infoId];
                if (data) {
                    const initialLatLng = {
                        lat: Number(data.location_latitude),
                        lng: Number(data.location_longitude)
                    };
                    googleMap.setCenter(initialLatLng);
                    googleMap.setZoom(detailZoomLevel);

                    setDetailDrawer(koji_infoId, 'koji_info');

                    $('body').removeClass('area-large area-middle').addClass('area-detail stay gd-stay');
                    if (window.innerWidth > 768) {
                        $('body').removeClass('stay');
                    }
                    globalThis.recordable = false;
                }
            }
            if ($('body').hasClass('single-est')) {
                const estId = String(mapInitialData.current_post_id);
                const data = dataAll['est'][estId];
                if (data) {
                    let targetLat = Number(data.location_latitude);
                    let targetLng = Number(data.location_longitude);
                    let firstZoneId = null;

                    try {
                        const zoneData = JSON.parse(data.zone_data || '{}');
                        const zoneIds = Object.keys(zoneData);

                        if (zoneIds.length > 0) {
                            firstZoneId = zoneIds[0];
                            const firstZone = zoneData[firstZoneId];
                            const pinLat = parseFloat(firstZone.pin_lat);
                            const pinLon = parseFloat(firstZone.pin_lon);

                            if (!isNaN(pinLat) && !isNaN(pinLon) && pinLat !== 0 && pinLon !== 0) {
                                targetLat = pinLat;
                                targetLng = pinLon;
                            }
                        }
                    } catch (e) {
                        console.error("用地データの解析に失敗:", e);
                    }

                    googleMap.setCenter({ lat: targetLat, lng: targetLng });
                    googleMap.setZoom(detailZoomLevel);
                    
                    setDetailDrawer(estId, 'est', firstZoneId);

                    $('body').removeClass('area-large area-middle').addClass('area-detail stay gd-stay');
                    if (window.innerWidth > 768) {
                        $('body').removeClass('stay');
                    }
                    globalThis.recordable = false;
                }
            }

            if (mapInitialData.direct_to_est) {
                var tgtId = mapInitialData.direct_to_est;
                var tgtData = dataAll['est'][tgtId];
                if (tgtData) { 
                    globalThis.recordMap = [];
                    globalThis.recordMapThis = 0;
                    globalThis.recordable = false;
                    goDetail(String(tgtData['id']), 'est', Number(tgtData['location_latitude']), Number(tgtData['location_longitude']));
                }
            }

            if (googleMap) {
                setupTooltipEvents(googleMap, mapTooltip);
            }
            
            $('#gdh-back , #gdh-handle').on('click',function(){
                $('body').addClass('gd-stay');
            });

            let ignoreResizeAfterBlur = false;
            $('input').on('focus', function() {
                $('body').addClass('input-focused');
                ignoreResizeAfterBlur = false;
            });
            $('input').on('blur', function() {
                $('body').removeClass('input-focused');
                ignoreResizeAfterBlur = true;
                setTimeout(function() {
                    ignoreResizeAfterBlur = false;
                }, 300);
            });

            const scrollContainerHp = document.querySelector('#help-modal-wrap .scroll-container-y');
            function helpScroll() {
                var scrollTopHp = scrollContainerHp.scrollTop;
                var hdc = $('#help-modal-wrap .hp-body > div').innerHeight();
                var btop = (scrollTopHp / hdc) * 100;
                $('.hp-scbar span').css('top', btop + '%');
            }
            $(document).on('click','.show-help', function(){
                var tgtHelp = $(this).attr('data-help');
                $('#help-content').html($('#contents-keeper [data-help="'+ tgtHelp +'"]').html());
                $('body').removeClass('hp-stay').addClass('dc-stay');
                var hdc = $('#help-modal-wrap .hp-body > div').innerHeight();
                var hwrap = $('#help-modal-wrap').innerHeight();
                var long = (hwrap / hdc) * 100;
                $('#help-content').css('height', hdc + 'px');
                $('.hp-scbar span').css('height', long + '%');
                if (long > 100) {
                    $('.hp-scbar').css('display', 'none');
                } else {
                    $('.hp-scbar').css('display', 'inline-block');
                }
                scrollContainerHp.removeEventListener('scroll',helpScroll);
                scrollContainerHp.addEventListener('scroll', helpScroll);
            })
            $('.hp-close').on('click', function(){
                $('body').toggleClass('hp-stay');
            })
          })(); // 静的ファイル fetch 後に初期化を完了
        };

});

function isPageWithMap() {
    var result = false;
    if (jQuery('body').hasClass('page-map')
        || jQuery('body').hasClass('page-test_map')
        || jQuery('body').hasClass('page-test_map2')
        || jQuery('body').hasClass('page-test_map_google')
        || jQuery('body').hasClass('page-test_map_google2')
        || jQuery('body').hasClass('page-test_map_temperature')
        || jQuery('body').hasClass('page-test_map_upc')
        || jQuery('body').hasClass('single-koji_info')
        || jQuery('body').hasClass('single-est')) {
            result = true;
        }
    return result;
}

// main_gis_test_temperature.js

// ... (他の関数は省略)

function initGoogleMap() {
    googleMap = new google.maps.Map(document.getElementById("googleMap"), {
        center: initLatLng,
        zoom: initZoom,
        gestureHandling: "greedy",
        mapTypeControl: false,
        fullscreenControl: false,
        streetViewControl: false,
        zoomControl: false,
        rotateControl: false,
        tiltControl: false,
        mapId: googleMapCustomId,
    });
    googleMap.setOptions({
        restriction: { latLngBounds: bounds, strictBounds: false }
    });
    initMarkerClusterer(googleMap);
    if (domain === 'hello-new-hokkaido.mma.jp') {
        enableDistanceMeasurementOnMap(googleMap);
    }

    if (googleMap?.data) {
        googleMap.data.setStyle(mainStyleFunction);
    }

    if (typeof transientGeoJSONs !== 'undefined' && googleMap?.data) {
        // upc_lv0/lv1/lv2 が存在する場合は upc_all のデータレイヤー追加をスキップ（重複防止）
        const allKeys = Object.keys(transientGeoJSONs);
        const hasUpcLevels = allKeys.some(k => /^upc_lv\d+$/.test(k));

        allKeys.forEach(key => {
            if (hasUpcLevels && key === 'upc_all') return;

            let geoJsonData = transientGeoJSONs[key];

            // 1. データが配列（Featureのリスト）なら、GeoJSON形式(FeatureCollection)にラップ
            if (Array.isArray(geoJsonData)) {
                geoJsonData = {
                    type: "FeatureCollection",
                    features: geoJsonData
                };
            }

            // 2. データ検証
            if (!geoJsonData || !geoJsonData.features) {
                return;
            }

            // 3. features がネストされたFeatureCollectionの場合はアンラップ
            while (!Array.isArray(geoJsonData.features) && geoJsonData.features && geoJsonData.features.type === 'FeatureCollection' && geoJsonData.features.features) {
                geoJsonData.features = geoJsonData.features.features;
            }

            // 3.5. features が配列でない場合は配列化（wp_localize_scriptによるobject変換対応）
            if (!Array.isArray(geoJsonData.features)) {
                geoJsonData.features = Object.values(geoJsonData.features);
            }

            // 3.6. features内のFeatureCollectionをフラット化
            geoJsonData.features = geoJsonData.features.reduce((acc, f) => {
                if (f && typeof f === 'object' && f.type === 'FeatureCollection' && f.features) {
                    const inner = Array.isArray(f.features) ? f.features : Object.values(f.features);
                    acc.push(...inner);
                } else {
                    acc.push(f);
                }
                return acc;
            }, []);

            // 4. 不正なFeatureの除去 (null や typeなし)
            geoJsonData.features = geoJsonData.features.filter(f => {
                return f && typeof f === 'object' && f.type === 'Feature';
            });

            let dataType = null;
            let level = null;

            if (key.startsWith('substation')) {
                dataType = 'substation';
            } else if (key.startsWith('lines')) {
                dataType = 'lines';
            } else if (key === 'cooling_all') {
                dataType = 'cooling';
            } else if (key === 'heating_all') {
                dataType = 'heating';
            } else if (key.startsWith('upc')) {
                dataType = 'upc';
            }

            const levelMatch = key.match(/_lv(\d+)$/);
            if (levelMatch) {
                level = parseInt(levelMatch[1], 10);
            }

            // プロパティの付与
            geoJsonData.features.forEach(feature => {
                if (!feature.properties) {
                    feature.properties = {};
                }
                if (dataType && !feature.properties.dataType) {
                    feature.properties.dataType = dataType;
                }
                if (level !== null && !feature.properties.level) {
                    feature.properties.level = level;
                }
            });

            // ★重要修正: addGeoJson は「追加されたFeatureの配列」を返すため、
            // 全データではなく「追加されたデータ」だけを対象にループ処理を行う
            const addedFeatures = googleMap.data.addGeoJson(geoJsonData);

            // ID再設定ロジック (最適化版)
            addedFeatures.forEach(function(feature) {
                const propertiesId = feature.getProperty('id');
                // feature.getId() が properties.id と異なる場合のみ再作成
                if (propertiesId && String(feature.getId()) !== String(propertiesId)) {
                    feature.toGeoJson(function(json) {
                        json.id = propertiesId;
                        googleMap.data.remove(feature);
                        googleMap.data.addGeoJson(json);
                    });
                }
            });
        });
    }

    plotMarker('koji_info');
    plotMarker('est');
    plotMarker('town');
    plotPhotoMarkers();
    enforceMarkerZIndex();
    
    setLayersFromUrl();
    
    // Google Maps API の読み込みと初期化が完了した後に、
    // WebGL チェックと地図のアイドルイベントリスナーを設定する
    google.maps.event.addListenerOnce(googleMap, 'idle', function() {
        checkWebGl();
        googleMap.addListener('idle', handleMapIdle);
    });
}

function waitForMarkerClusterer(callback) {
    if (window.MarkerClusterer) {
        callback();
    } else {
        setTimeout(() => waitForMarkerClusterer(callback), 100);
    }
}

function initMarkerClusterer(map) {
    waitForMarkerClusterer(() => {
        if (!markerClusters['google']) {
            markerClusters['google'] = new MarkerClusterer(map, [], {
                imagePath: 'https://developers.google.com/maps/documentation/javascript/examples/markerclusterer/m',
                gridSize: 35,
                maxZoom: detailZoomLevel,
            });
        }
    });
}

function getPolygonCenter(paths) {
    let latSum = 0, lngSum = 0, count = 0;
    paths[0].forEach(point => {
        latSum += point.lat;
        lngSum += point.lng;
        count++;
    });
    return { lat: latSum / count, lng: lngSum / count };
}

function setModalPhone (name, tel) {
    var modalHtml = '';
    modalHtml = `<div>
<p>
${name}に発信します。<br>
お電話口で「HELLO NEW HOKKAIDO」を見たとお伝えください。
</p>
<a href="tel:${tel}" class="for-call"><span>発信 （${tel}）</span></a>
<a class="for-cancel"><span>キャンセル</span></a>
<div>`;
    jQuery('#detail-modal').html(modalHtml);
}

function reorderMap() {
    const qgisList = ['kogyo_danchi1'];

    if (typeof mapLayers !== "undefined") {
        qgisList.forEach((type) => {
            if (mapLayers[type]) {
                mapLayers[type].forEach(item => {
                    if (item.setMap && item.getMap && item.getMap() !== null) {
                        item.setMap(null);
                        item.setMap(googleMap);
                        if (item.div) {
                            item.div.style.zIndex = "1";
                        }
                    }
                });
            }
        });
    }

    ['substation_lv0', 'substation_lv1', 'substation_lv2','koji_info'].forEach((layer, index) => {
        if (mapLayers[layer] && isLayerShown[layer]) {
            mapLayers[layer].forEach(marker => {
                if (marker.getMap() !== null) {
                    marker.setMap(null);
                    marker.setMap(googleMap);
                    marker.setZIndex(999 + index);
                }
            });
        }
    });

    ['koji_info'].forEach((layer) => {
        const cluster = markerClusters[layer];
        if (mapState.getMode() === 'search') {
            if (cluster) {
                const visibleMarkers = mapLayers[layer]?.filter(marker => marker.getMap() !== null) || [];
                cluster.clearMarkers();
                cluster.addMarkers(visibleMarkers);
            }
        } else {
            if (cluster) {
                const visibleMarkers = mapLayers[layer];
                cluster.clearMarkers();
                cluster.addMarkers(visibleMarkers);
            }
        }
    });
}

function hideGoogleLayers(map, tgtLayer) {
    if (tgtLayer === 'town') {
        return;
    }
    if (tgtLayer === 'all') {
        var layerNames = ['koji_info', 'est', 'town'];
        layerNames.forEach((name) => {
            if (mapLayers[name]) {
                mapLayers[name].forEach(marker => marker.setMap(null));
                mapLayers[name] = [];
            }
            if (mapLayers[name + '_cluster']) {
                mapLayers[name + '_cluster'].clearMarkers();
                mapLayers[name + '_cluster'] = null;
            }
        });
    } else {
        if (mapLayers[tgtLayer]) {
            mapLayers[tgtLayer].forEach(marker => marker.setMap(null));
            mapLayers[tgtLayer] = [];
        }
        if (mapLayers[tgtLayer + '_cluster']) {
            mapLayers[tgtLayer + '_cluster'].clearMarkers();
            mapLayers[tgtLayer + '_cluster'] = null;
        }
    }
}

function goMapEstDetail(id) {
    location.href = '/' + returningPage + '/?ge=' + id;
}

function getLiAlways(base,word) {
    if (base == true || base == false) {
        return '<li class="' + base +'">' + word + '</li>';
    } else {
        return '';
    }
}
function getLiIfTrue(base,word) {
    if (base == true) {
        return '<li class="true">' + word + '</li>';
    } else {
        return '';
    }
}

function trimAllSpaces(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/^\s+|\s+$/gu, '');
}

function convertFullWidthToHalfWidth(str) {
    if (typeof str !== 'string') return '';
    var str2 = str.replace(/－/g, "-");
    return str2.replace(/[０-９]/g, (fullWidthChar) => {
        return String.fromCharCode(fullWidthChar.charCodeAt(0) - 0xFEE0);
    });
}

function formatTime(timeStr) {
    if (typeof timeStr !== 'string' || timeStr.length < 2) return '';
    return `${timeStr.slice(0, 2)}:${timeStr.slice(2)}`;
}

function fixedText(str) {
    if (typeof str !== 'string') {
        if (str) {
            console.warn('fixedText関数に文字列でない値が渡されました:', str);
        }
        return '──';
    }
    return str.replace(/<span[^>]*>|<\/span>/g, '').replace(/\n/g, '<br>');
}

function fixedTextArea(str) {
    if (typeof str !== 'string') {
        if (str) { console.warn('fixedTextAreaに文字列でない値が渡されました:', str); }
        return '';
    }

    let processedStr = str;
    processedStr = processedStr.replace(/(<\/span>)(.*?)(?=<span|$)/gs, (match, closingSpan, content) => {
        const trimmedContent = content.trim();
        return trimmedContent ? `${closingSpan}<p>${trimmedContent}</p>` : closingSpan;
    });
    processedStr = processedStr.replace(/(<span[^>]*>.*?<\/span><p>.*?<\/p>)/g, '<div>$1</div>');
    processedStr = processedStr.replace(/<span([^>]*)>(.*?)<\/span>/g, (match, attributes, content) => {
        const textContent = content.replace(/<[^>]*>/g, '').trim();
        let newClass = '';
        if (textContent.length > 0 && textContent.length <= 2) {
            newClass = 'short';
        } else if (textContent.length >= 6) {
            newClass = 'long';
        }
        if (!newClass) return match;
        if (attributes.includes('class="')) {
            return `<span${attributes.replace('class="', `class="${newClass} `)}>${content}</span>`;
        } else {
            return `<span class="${newClass}"${attributes}>${content}</span>`;
        }
    });
    processedStr = replaceHelpButton(processedStr);
    processedStr = changeBunkatsuHtml(processedStr);
    processedStr = processedStr.replace(/\r?\n/g, '<br>');
    return processedStr;
}

function changeBunkatsuHtml(html) {
    if (typeof html !== 'string') return html;
    return html.replace(/---分割線---/g, '<span class="bunkatsu">---</span>');
}

function replaceHelpButton(str) {
    if (typeof str !== 'string') return '';
    const regex = /（？：(.*?)）/g;
    return str.replace(regex, function(match, helpText) {
        const escaped = helpText.replace(/'/g, "\\'");
        return `<span class="help-trigger" onclick="showHelp('${escaped}')">？</span>`;
    });
}
function showHelp(key) {
    const $source = mm_contents_keeper[key];
    if (!$source || !$source['code']) return;
    jQuery('#help-content').html($source['code']);
    jQuery('body').removeClass('hp-stay').addClass('dc-stay');
    const scrollContainerHp = document.querySelector('#help-modal-wrap .scroll-container-y');
    const hdc = jQuery('#help-content').innerHeight();
    const hwrap = jQuery('#help-modal-wrap').innerHeight();
    const scrollBarHeightPercent = (hwrap / hdc) * 100;
    jQuery('.hp-scbar span').css('height', scrollBarHeightPercent + '%');
    if (scrollBarHeightPercent > 100) {
        jQuery('.hp-scbar').hide();
    } else {
        jQuery('.hp-scbar').css('display', 'inline-block');
    }
    function helpScroll() {
        const scrollTopHp = scrollContainerHp.scrollTop;
        const btop = (scrollTopHp / hdc) * 100;
        jQuery('.hp-scbar span').css('top', btop + '%');
    }
    scrollContainerHp.removeEventListener('scroll', helpScroll);
    scrollContainerHp.addEventListener('scroll', helpScroll);
}

function initializeMapTooltip() {
    const tooltip = document.createElement('div');
    tooltip.id = 'map-tooltip';
    tooltip.className = 'map-tooltip-popup'; 
    document.body.appendChild(tooltip);
    return tooltip;
}

function setupTooltipEvents(map, tooltipElement) {
    map.data.addListener('mousemove', (event) => {
        if (event.feature.getProperty('estid')) {
            tooltipElement.style.left = `${event.domEvent.clientX + 15}px`;
            tooltipElement.style.top = `${event.domEvent.clientY + 15}px`;
        }
    });
}

async function saveMap() {
    await recordMapAndDrawer();
}

function toggleDrawer() {
    jQuery(function($){
        if (window.innerWidth <= 768) {
            var hdrw;
            var hdrw1 = jQuery('#mapDrawer #for-point').height();
            var hdrw2 = jQuery('#mapDrawer #for-detail-koji_info').height() + jQuery('#mapDrawer #for-detail-est').height() + jQuery('#mapDrawer #for-detail-town').height() + jQuery('#mapDrawer #for-detail-photo').height();
            var addHeight = 0;
            if (jQuery('body').hasClass('area-detail')) {
                hdrw = hdrw2 + 100;
            } else {
                hdrw = hdrw1;
            }
            var hwin = window.innerHeight;
            if (hdrw < 10) {
                jQuery('#mapDrawer').css('top', '-152px');
                jQuery('.dw-body-wrap').css('height','calc(152px - 60px)');
            } else if (hwin - 90 > hdrw) {
                var smallDrawerSize = '-' + parseInt(hdrw + 90) + 'px';
                jQuery('#mapDrawer').css('top',smallDrawerSize);
                jQuery('.dw-body-wrap').css('height','calc(' + Math.abs(parseInt(hdrw + 90)) + 'px - 60px)');
            } else {
                jQuery('#mapDrawer').css('top', 'calc(var(--vh, 1vh) * 100 * -1)');
                jQuery('.dw-body-wrap').css('height','calc(var(--vh, 1vh) * 100 - 60px)');
            }
        } else {
            jQuery('#mapDrawer').css('top', '0');
        }

        if (jQuery('#gc-slider').hasClass('slick-initialized')) {
            jQuery('#gc-slider').slick('unslick');
        }

        updateNoResultMessage();

        jQuery('body').addClass('dc-stay gd-stay').toggleClass('stay');
    })
}

function recordMapAndDrawer() {
    var deferred = jQuery.Deferred();
    var now = globalThis.recordMapNow;
    var ids = [];
    jQuery('#for-point li[data-delbysearch=""]').each(function(){
        ids.push(jQuery(this).attr('data-id'));
    });
    globalThis.recordMap[now] = {
        center: {
            lat: Number(googleMap.getCenter().lat()),
            lon: Number(googleMap.getCenter().lng()),
        },
        zoom: Number(googleMap.getZoom()),
        ids: ids,
    };
    globalThis.recordMapNow++;
    jQuery('body').addClass('has-record');
    deferred.resolve();
    return deferred.promise();
}

function backToRecordMap() {
    jQuery(function($){
        const drawerBody = document.querySelector('#mapDrawer .dw-body.scroll-container-y');
        if (drawerBody) {
            drawerBody.scrollTop = 0;
        }

        // 見た目をリスト表示に戻す
        jQuery('body').removeClass('area-detail geojson-detail-view').addClass('area-large');
        mapState.setMode('search');

        currentViewingMarkerId = null;
        isGeoJsonDetailView = false;
        detailGeoJsonInfo = null;

        const backNum = globalThis.recordMapNow - 1;
        if (backNum >= 0 && globalThis.recordMap[backNum] && globalThis.recordMap[backNum].ids) {
            const recordedState = globalThis.recordMap[backNum];
            const visibleIds = recordedState.ids;

            updateDrawerList(visibleIds);
            persistentSearchResult = {};

            const geoJsonTypes = ['substation_all', 'lines_all', 'kogyo_danchi1_all'];
            geoJsonTypes.forEach(typeKey => {
                persistentSearchResult[typeKey] = [];
            });
            tgtTypeList.forEach(type => {
                persistentSearchResult[type] = [];
            });
            persistentSearchResult['photo'] = [];

            visibleIds.forEach(id => {
                const strId = String(id);
                if (dataAll.koji_info[strId]) persistentSearchResult.koji_info.push(strId);
                else if (dataAll.est[strId]) persistentSearchResult.est.push(strId);
                else if (dataAll.town[strId]) persistentSearchResult.town.push(strId);
                else if (geoSearchData.substation_all.some(item => String(item.id) === strId)) persistentSearchResult.substation_all.push(strId);
                else if (geoSearchData.lines_all.some(item => String(item.id) === strId)) persistentSearchResult.lines_all.push(strId);
                else if (geoSearchData.kogyo_danchi1_all.some(item => String(item.id) === strId)) persistentSearchResult.kogyo_danchi1_all.push(strId);
                else {
                    // 写真IDの判定（transientGeoJSONsから確認）
                    if (typeof transientGeoJSONs !== 'undefined' && transientGeoJSONs['photo_tetto_lite']) {
                        let features = transientGeoJSONs['photo_tetto_lite'].features;
                        if (!Array.isArray(features) && typeof features === 'object') features = Object.values(features);
                        if (features.some(f => String(f.id || (f.properties && f.properties.id)) === strId)) {
                            persistentSearchResult['photo'].push(strId);
                        }
                    }
                }
            });
            
            tgtTypeList.forEach((tgtType) => {
                if (mapLayers[tgtType]) {
                    mapLayers[tgtType].forEach(marker => {
                        const markerId = (tgtType === 'est') ? String(marker.customLandId) : String(marker.id);
                        marker.setVisible((persistentSearchResult[tgtType] || []).includes(markerId));
                    });
                }
                updateCluster(tgtType);
            });

            // 写真マーカーの表示/非表示とクラスター更新
            if (mapLayers.photo) {
                const photoIds = persistentSearchResult['photo'] || [];
                mapLayers.photo.forEach(marker => {
                    marker.setVisible(photoIds.includes(String(marker.id)));
                });
                updateCluster('photo');
            }

            googleMap.data.setStyle(googleMap.data.getStyle());
            changeLayer('lines', isLayerShown['lines']);

            googleMap.setCenter({
                lat: Number(recordedState.center.lat),
                lng: Number(recordedState.center.lon)
            });
            googleMap.setZoom(Number(recordedState.zoom));

            globalThis.recordMap.splice(backNum, 1);
            globalThis.recordMapNow--;
        }

        if (globalThis.recordMapNow === 0) {
            jQuery('body').removeClass('has-record');
            endModeSearch();
        } else {
            updateNoResultMessage();
        }
    });
}

function dcClose( ) {
    var dwClass = '';
    if (mapPageInfo['drawerOpening']) {
        mapPageInfo['drawerOpening'].forEach((drawerClass) => {
            dwClass += ' ' + drawerClass;
        })
        jQuery('body').removeClass(dwClass).addClass('dc-stay');
        mapPageInfo['drawerOpening'] = [];
    }
}

function isZoomOver(num) {
    if (!googleMap || typeof googleMap.getZoom !== "function") {
        console.error("Error: googleMap is not initialized.");
        return false;
    }
    return googleMap.getZoom() >= num;
}

function getLongestMapDistanceInKm(map) {
    const bounds = map.getBounds();
    if (!bounds) {
        console.warn("地図がまだ初期化されていない可能性があります。");
        return null;
    }

    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();

    const verticalDistance = google.maps.geometry.spherical.computeDistanceBetween(
        new google.maps.LatLng(ne.lat(), ne.lng()),
        new google.maps.LatLng(sw.lat(), ne.lng())
    );

    const horizontalDistance = google.maps.geometry.spherical.computeDistanceBetween(
        new google.maps.LatLng(ne.lat(), ne.lng()),
        new google.maps.LatLng(ne.lat(), sw.lng())
    );

    const maxDistanceMeters = Math.max(verticalDistance, horizontalDistance);
    return maxDistanceMeters / 1000;
}

function enableDistanceMeasurementOnMap(map) {
    let path = [];
    let markers = [];
    let labelOverlay = null;
  
    const polyline = new google.maps.Polyline({
      map,
      path,
      strokeColor: "#FF0000",
      strokeOpacity: 1.0,
      strokeWeight: 3,
    });
  
    class DistanceLabelOverlay extends google.maps.OverlayView {
      constructor(position, content) {
        super();
        this.position = position;
        this.content = content;
        this.div = null;
      }
  
      onAdd() {
        this.div = document.createElement("div");
        this.div.className = "distance-popup";
        this.div.innerHTML = this.content;
  
        this.div.querySelector('.distance-close')?.addEventListener('click', () => {
          polyline.setPath([]);
          path = [];
          markers.forEach(m => m.setMap(null));
          markers = [];
          if (labelOverlay) {
            labelOverlay.setMap(null);
            labelOverlay = null;
          }
        });
  
        const panes = this.getPanes();
        panes.floatPane.appendChild(this.div);
      }
  
      draw() {
        const projection = this.getProjection();
        if(!projection) return;
        const pos = projection.fromLatLngToDivPixel(this.position);
        if (this.div && pos) {
          this.div.style.position = "absolute";
          this.div.style.left = pos.x + "px";
          this.div.style.top = pos.y + "px";
        }
      }
  
      onRemove() {
        if (this.div) {
          this.div.remove();
          this.div = null;
        }
      }
    }
  
    map.addListener("rightclick", function (e) {
      const latLng = e.latLng;
      path.push(latLng);
      polyline.setPath(path);
  
      const marker = new google.maps.Marker({
        position: latLng,
        map: map,
      });
      markers.push(marker);
  
      if (path.length >= 2) {
        const distance = google.maps.geometry.spherical.computeLength(path);
        const content = `
          <div class="distance-label">
            距離: ${(distance / 1000).toFixed(2)} km
            <span class="distance-close" style="margin-left: 8px;">×</span>
          </div>
        `;
  
        if (labelOverlay) {
          labelOverlay.setMap(null);
        }
  
        labelOverlay = new DistanceLabelOverlay(latLng, content);
        labelOverlay.setMap(map);
      }
    });
  }

function showResultZero() {
    if (resultGoogleNum == 0) {
        document.body.classList.add('show-resultZero');
        setTimeout(() => {
            document.body.classList.remove('show-resultZero');
        }, 1200);
    }
}

function numOrBar(value) {
    if (value) {
        if (typeof value === "string") {
            value = value.replace(/,/g, "");
        }
        const num = Number(value);
        return isNaN(num) ? "Invalid Number" : num.toLocaleString();
    } else {
        return '──';
    }
}

function convertDataBgToStyle(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/data-bg="([^"]+)"/g, 'style="background:$1;"');
}

function hexToRgbArray(hex) {
    const cleanHex = hex.replace("#", "");
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    return [r, g, b];
}

function setFullHeight() {
    document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
}
window.addEventListener('resize', setFullHeight);
window.addEventListener('orientationchange', setFullHeight);
setFullHeight();

function calculateDistance(center1, center2) {
    if (!center1 || !center2) {
        return Infinity;
    }
    return google.maps.geometry.spherical.computeDistanceBetween(center1, center2);
}

function initializeDrawerScrollbar() {
    const drawerBody = document.querySelector('#mapDrawer .dw-body');
    const scrollbar = document.querySelector('#mapDrawer .dw-scrollbar');
    const thumb = document.querySelector('#mapDrawer .dw-scrollbar-thumb');

    if (!drawerBody || !scrollbar || !thumb) return;

    const updateScrollbar = () => {
        requestAnimationFrame(() => {
            const scrollHeight = drawerBody.scrollHeight;
            const clientHeight = drawerBody.clientHeight;

            if (scrollHeight > clientHeight) {
                scrollbar.style.display = 'block';
                const thumbHeight = Math.max(20, (clientHeight / scrollHeight) * clientHeight);
                thumb.style.height = `${thumbHeight}px`;
            } else {
                scrollbar.style.display = 'none';
            }
        });
    };

    const syncThumbPosition = () => {
        const scrollHeight = drawerBody.scrollHeight;
        const clientHeight = drawerBody.clientHeight;
        if (scrollHeight <= clientHeight) return;

        const scrollTop = drawerBody.scrollTop;
        const thumbHeight = thumb.offsetHeight;
        
        const scrollbarHeight = scrollbar.clientHeight;
        
        const maxScrollTop = scrollHeight - clientHeight;
        const maxThumbTop = scrollbarHeight - thumbHeight;
        
        if (maxScrollTop > 0) {
            const thumbTop = (scrollTop / maxScrollTop) * maxThumbTop;
            thumb.style.top = `${thumbTop}px`;
        }
    };

    drawerBody.addEventListener('scroll', syncThumbPosition);

    let isDragging = false;
    let startY, startScrollTop;

    thumb.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        isDragging = true;
        startY = e.clientY;
        startScrollTop = drawerBody.scrollTop;
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const clientHeight = drawerBody.clientHeight;
        const scrollHeight = drawerBody.scrollHeight;
        const thumbHeight = thumb.offsetHeight;

        if (scrollHeight <= clientHeight) return;

        const scrollbarHeight = scrollbar.clientHeight;

        const maxScrollTop = scrollHeight - clientHeight;
        const maxThumbTop = scrollbarHeight - thumbHeight;

        const deltaY = e.clientY - startY;
        
        if (maxThumbTop > 0) {
            const scrollDelta = (deltaY / maxThumbTop) * maxScrollTop;
            drawerBody.scrollTop = startScrollTop + scrollDelta;
        }
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            document.body.style.userSelect = '';
        }
    });

    const observer = new MutationObserver(() => {
        updateScrollbar();
        syncThumbPosition();
    });
    
    const contentContainer = drawerBody.querySelector('div');
    if (contentContainer) {
        observer.observe(contentContainer, {
            childList: true,
            subtree: true,
            attributes: true
        });
    }

    window.addEventListener('resize', updateScrollbar);
    updateScrollbar();
}

function getEstAccordionState() {
    try {
        const state = localStorage.getItem('estAccordionState');
        return state ? JSON.parse(state) : [];
    } catch (e) {
        console.error('Failed to parse estAccordionState from localStorage', e);
        return [];
    }
}

function saveEstAccordionState() {
    const closedBlocks = document.querySelectorAll('#for-detail-est .est-block.is-closed');
    const closedIds = Array.from(closedBlocks).map(block => block.getAttribute('data-close'));
    localStorage.setItem('estAccordionState', JSON.stringify(closedIds));
}

window.addEventListener('load', function() {
    initializeDrawerScrollbar();
});

// 凡例は静的HTMLのため、JS側での描画は不要

class CustomTemperaturePopup extends google.maps.OverlayView {
    constructor(googleMap) {
        super();
        this.map = googleMap;
        this.div = null;
        this.setMap(googleMap);
    }

    onAdd() {
        const div = document.createElement('div');
        div.className = "geo-popup-container";
        div.style.position = "absolute";
        div.style.display = "none";
        div.style.zIndex = "1001";
        this.div = div;
        this.getPanes().floatPane.appendChild(div);
    }

    show(latLng, content) {
        if (!this.div) return;

        if (window.linePopup) window.linePopup.hide();
        if (window.substationPopup) window.substationPopup.hidePopup();
        if (window.polygonPopup) window.polygonPopup.hidePopup();
        this.div.innerHTML = `<div class="geo-popup geo-popup-temperature">${content}</div>`;
        
        const projection = this.getProjection();
        if (!projection) return;
        
        const pixelPosition = projection.fromLatLngToDivPixel(latLng);
        if (pixelPosition) {
            this.div.style.left = `${pixelPosition.x + 15}px`;
            this.div.style.top = `${pixelPosition.y - 15}px`;
            this.div.style.display = "block";
        }
    }

    hide() {
        if (this.div) {
            this.div.style.display = "none";
        }
    }

    onRemove() {
        if (this.div) {
            this.div.parentNode.removeChild(this.div);
            this.div = null;
        }
    }

    draw() {}
}

// 写真ポップアップを表示するグローバル関数
window.openPhotoPopup = function(src) {
    const $overlay = jQuery('#photo-popup-overlay');
    const $image = $overlay.find('#popup-image');
    $image.attr('src', src);
    $overlay.css('display', 'flex');
    setTimeout(() => {
        $overlay.addClass('show');
    }, 10);
    document.body.style.overflow = 'hidden';
};

// 写真ポップアップを閉じるグローバル関数
window.closePhotoPopup = function() {
    const $overlay = jQuery('#photo-popup-overlay');
    $overlay.removeClass('show');
    setTimeout(() => {
        $overlay.hide();
        $overlay.find('#popup-image').attr('src', '');
    }, 300);
    document.body.style.overflow = '';
};
