/**
 * GeoJSON（電力設備、工業団地、用地ポリゴン）の
 * 描画、スタイル設定、インタラクションを担当するファイル
 */

/**
 * すべてのGeoJSONフィーチャのメインスタイルを決定します。
 */
function mainStyleFunction(feature) {
    const mode = mapState.getMode();
    
    if (mode === 'search') {
        return getStyleForSearchMode(feature, persistentSearchResult, mapState);
    }
    
    const normalStyle = getStyleForNormalView(feature, mapState);

    if (mode === 'detail' || mode === 'geojson-detail') {
        const detailInfo = mapState.getCurrentDetail();

        if (!detailInfo.id) {
            return normalStyle;
        }

        const featureId = String(feature.getProperty('id'));
        const featureType = determineFeatureType(feature);

        let isTargetFeature = false;
        
        if (featureType === 'est_zone') {
            const estIdMatch = String(feature.getProperty('estid')) === String(detailInfo.id);
            const zoneIdMatch = String(feature.getProperty('zoneid')) === String(detailInfo.zoneId);
            if (detailInfo.type === 'est' && estIdMatch && zoneIdMatch) {
                isTargetFeature = true;
            }
        } else {
            if (featureType === detailInfo.type && featureId === detailInfo.id) {
                isTargetFeature = true;
            }
        }
        
        if (isTargetFeature) {
            const highlightedStyle = { ...normalStyle };

            if (featureType === 'est_zone') {
                highlightedStyle.strokeWeight = 2;
                highlightedStyle.fillOpacity = 0.6;
                highlightedStyle.zIndex = 151;
            } else if (featureType === 'substation') {
                highlightedStyle.icon = { ...normalStyle.icon };
                highlightedStyle.icon.strokeColor = '#FFFF00';
                highlightedStyle.icon.strokeWeight = 3;
                highlightedStyle.zIndex = 141;
            } else if (featureType === 'lines') {
                highlightedStyle.strokeColor = '#FFFF00';
                highlightedStyle.strokeWeight = (normalStyle.strokeWeight || 2) + 2;
                highlightedStyle.zIndex = 121;
            } else if (featureType === 'upc') {
                // UPC: Data layer は不可視のまま、Polyline 側で黄色ハイライト
                if (typeof updateUpcPolylines === 'function') updateUpcPolylines();
                return normalStyle;
            }
            return highlightedStyle;
        }
    }
    return normalStyle;
}

/**
 * 通常表示モードのスタイルを決定する
 */
function getStyleForNormalView(feature, state) {
    const featureType = determineFeatureType(feature);
    let styleOptions = { visible: false };

    if (featureType === 'substation') {
        const isVisible = state.isLayerVisible('substation') &&
            !(feature.getProperty('level') === 1 && !state.isZoomOver(8)) &&
            !(feature.getProperty('level') === 2 && !state.isZoomOver(10)) &&
            (feature.getProperty('Vsbl') !== 1 && feature.getProperty('Vsbl') !== true);
        if (isVisible) {
            const properties = {};
            feature.forEachProperty((value, key) => { properties[key] = value; });
            const rankVolt = (properties["空容量"] == null || properties["空容量"] > 0) ? getRankOfVolt(properties["一次側"]) : getRankOfVolt(properties["二次側"]);
            styleOptions = {
                icon: { path: google.maps.SymbolPath.CIRCLE, scale: Math.max(6, 3 * (rankVolt + 1)), strokeWeight: 1, strokeColor: 'rgba(0,0,0,0.4)', fillColor: 'rgba(136, 136, 136, 1)', fillOpacity: 1 },
                visible: true, clickable: true, zIndex: 140
            };
        }
    } else if (featureType === 'photo') { 
        // ★修正: 写真は CustomPostMarker で表示するため、GeoJSON側は常に非表示にする
        styleOptions = { visible: false };
    } else if (featureType === 'kogyo_danchi1') {
        if (state.isLayerVisible('kogyo_danchi1')) {
            styleOptions = { strokeColor: layerColors.kogyo_danchi1, strokeOpacity: 1.0, strokeWeight: 0, fillColor: layerColors.kogyo_danchi1, fillOpacity: 0.2, visible: true, clickable: false, zIndex: 110 };
        }
    } else if (featureType === 'cooling' || featureType === 'heating') {
        if (state.isLayerVisible(featureType)) {
            const value = feature.getProperty(featureType === 'cooling' ? 'ELEV_min' : 'Th100_min');
            const result = getTemperatureColor(value, featureType);
            styleOptions = { strokeWeight: 0, fillColor: result.color, fillOpacity: result.opacity, visible: true, clickable: false, zIndex: 50 };
        }
    } else if (featureType === 'est_zone') {
        const isLayerVisible = state.isLayerVisible('est');
        const isZoomLevelOk = state.isZoomOver(13);
        const status = feature.getProperty('status');
        if (isLayerVisible && isZoomLevelOk && status === '分譲中') {
            const color = zoneStatus[status]?.color || '#7dccf3';
            styleOptions = {
                strokeColor: color,
                strokeOpacity: 0.8,
                strokeWeight: 2,
                fillColor: color,
                fillOpacity: 0.3,
                visible: true,
                clickable: true,
                zIndex: 145
            };
        }
    } else if (featureType === 'lines') {
        const isVisible = state.isLayerVisible('lines') &&
            !(feature.getProperty('level') === 1 && !state.isZoomOver(8)) &&
            !(feature.getProperty('level') === 2 && !state.isZoomOver(10)) &&
            (feature.getProperty('N_Vsbl') !== 1 && feature.getProperty('N_Vsbl') !== true);
        if (isVisible) {
            const color = mvColor[getRankOfMv(feature.getProperty('N_OrdCur'), feature.getProperty('N_crgCtrl'))];
            const weight = getWidthOfVolt(feature.getProperty('Voltage'));
            styleOptions = {
                strokeColor: color,
                strokeWeight: weight,
                strokeOpacity: 1.0,
                visible: true,
                clickable: true,
                zIndex: 120
            };
        }
    } else if (featureType === 'upc') {
        const isVisible = state.isLayerVisible('upc') &&
            !(feature.getProperty('level') === 1 && !state.isZoomOver(8)) &&
            !(feature.getProperty('level') === 2 && !state.isZoomOver(10)) &&
            (feature.getProperty('N_Vsbl') !== 1 && feature.getProperty('N_Vsbl') !== true);
        if (isVisible) {
            const color = mvColor[getRankOfMv(feature.getProperty('N_OrdCur'), feature.getProperty('N_crgCtrl'))];
            const weight = getWidthOfVolt(feature.getProperty('Voltage'));
            styleOptions = {
                strokeColor: color,
                strokeWeight: weight * 2,
                strokeOpacity: 0,
                visible: true,
                clickable: true,
                zIndex: 120
            };
        }
    }
    return styleOptions;
}

function getStyleForSearchMode(feature, searchResults, state) {
    const featureId = String(feature.getId() || feature.getProperty('id'));
    const featureType = determineFeatureType(feature);
    let styleOptions = null;
    let isVisibleInSearch = false;

    // 各GeoJSONタイプについて、検索結果に含まれているかどうかに加え、
    // 該当レイヤーが表示設定になっている（トグルボタンがON）かもチェックする
    if (featureType === 'substation') {
        isVisibleInSearch = state.isLayerVisible('substation') && (searchResults.substation_all || []).includes(featureId);
    } else if (featureType === 'lines') {
        isVisibleInSearch = state.isLayerVisible('lines') && (searchResults.lines_all || []).includes(featureId);
    } else if (featureType === 'kogyo_danchi1') {
        isVisibleInSearch = state.isLayerVisible('kogyo_danchi1') && (searchResults.kogyo_danchi1_all || []).includes(featureId);
    } else if (featureType === 'upc') {
        isVisibleInSearch = state.isLayerVisible('upc') && (searchResults.upc_all || []).includes(featureId);
    } else if (featureType === 'est_zone') {
        const isParentInSearch = state.isLayerVisible('est') && (searchResults.est || []).includes(String(feature.getProperty('estid')));
        const isAvailable = feature.getProperty('status') === '分譲中';
        isVisibleInSearch = isParentInSearch && isAvailable;
    } else if (featureType === 'photo') {
        // ★追加: 写真マーカーの検索判定
        isVisibleInSearch = state.isLayerVisible('photo') && (searchResults.photo || []).includes(featureId);
    } else if (featureType === 'cooling' || featureType === 'heating') {
        // 冷暖房レイヤーは検索対象外のため、トグルONなら常に表示を維持
        if (state.isLayerVisible(featureType)) {
            return getStyleForNormalView(feature, state);
        }
        return { visible: false };
    }

    if (isVisibleInSearch) {
        styleOptions = getStyleForNormalView(feature, state);
    } else {
        styleOptions = { visible: false };
    }

    return styleOptions;
}

/**
 * GeoJSON詳細表示モードのスタイルを決定する
 */
function getStyleForDetailView(feature, detailInfo) {
    const featureId = String(feature.getId() || feature.getProperty('id'));
    const featureType = determineFeatureType(feature);
    let styleOptions = { visible: false };

    if (featureType === 'est_zone') {
        if (detailInfo.type === 'est' && String(feature.getProperty('estid')) === String(detailInfo.id)) {
            const isTargetZone = detailInfo.zoneId && String(feature.getProperty('zoneid')) === String(detailInfo.zoneId);
            const status = feature.getProperty('status') || '分譲中';
            const color = zoneStatus[status]?.color || '#7dccf3';

            styleOptions = {
                strokeColor: color,
                strokeOpacity: 1.0,
                strokeWeight: 2,
                fillColor: color,
                fillOpacity: isTargetZone ? 0.6 : 0.3,
                visible: true,
                clickable: true,
                zIndex: 150
            };
        }
        return styleOptions;
    }

    if (featureType === detailInfo.type && featureId === detailInfo.id) {
        if (featureType === 'substation') {
            const properties = {};
            feature.forEachProperty((value, key) => { properties[key] = value; });
            const rankVolt = (properties["空容量"] == null || properties["空容量"] > 0) ? getRankOfVolt(properties["一次側"]) : getRankOfVolt(properties["二次側"]);
            styleOptions = {
                icon: { path: google.maps.SymbolPath.CIRCLE, scale: Math.max(6, 3 * (rankVolt + 1)), strokeWeight: 1, strokeColor: 'rgba(0,0,0,0.4)', fillColor: 'rgba(136, 136, 136, 1)', fillOpacity: 1 },
                visible: true, clickable: true, zIndex: 140
            };
        } else if (featureType === 'kogyo_danchi1') {
            styleOptions = { strokeColor: layerColors.kogyo_danchi1, fillColor: layerColors.kogyo_danchi1, strokeOpacity: 1.0, strokeWeight: 0, fillOpacity: 0.2, visible: true, clickable: !mapState.isLayerVisible('est'), zIndex: 110 };
        } else if (featureType === 'lines') {
            const color = mvColor[getRankOfMv(feature.getProperty('N_OrdCur'), feature.getProperty('N_crgCtrl'))];
            const weight = getWidthOfVolt(feature.getProperty('Voltage'));
            styleOptions = {
                strokeColor: color, strokeWeight: weight, strokeOpacity: 1.0,
                visible: true, clickable: true, zIndex: 120
            };
        }
    }
    return styleOptions;
}


// --- ▼▼▼ UPC Polyline（点線表示）関連 ▼▼▼ ---

/**
 * transientGeoJSONs から UPC フィーチャの Polyline を生成し window.upcPolylines に格納
 * Data layer は strokeOpacity:0 で不可視にし、Polyline で短破線（dashed）表示を行う
 */
function createUpcPolylinesFromFeatures() {
    if (!window.googleMap || typeof transientGeoJSONs === 'undefined') return;
    window.upcPolylines = [];

    // upc_lv0/lv1/lv2 が存在する場合は upc_all をスキップ（重複防止）
    const upcKeys = Object.keys(transientGeoJSONs).filter(k => k.startsWith('upc'));
    const hasLevelKeys = upcKeys.some(k => /^upc_lv\d+$/.test(k));

    upcKeys.forEach(key => {
        if (hasLevelKeys && key === 'upc_all') return;
        const geoJson = transientGeoJSONs[key];
        if (!geoJson?.features) return;

        const levelMatch = key.match(/_lv(\d+)$/);
        const level = levelMatch ? parseInt(levelMatch[1], 10) : null;

        geoJson.features.forEach(feature => {
            if (!feature?.geometry) return;
            const props = feature.properties || {};
            if (props['N_Vsbl'] === 1 || props['N_Vsbl'] === true) return;

            const featureId = String(feature.id || props.id || '');
            const color = mvColor[getRankOfMv(props['N_OrdCur'], props['N_crgCtrl'])];
            const weight = getWidthOfVolt(props['Voltage']);

            let paths = [];
            if (feature.geometry.type === 'LineString') {
                paths = [feature.geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] }))];
            } else if (feature.geometry.type === 'MultiLineString') {
                paths = feature.geometry.coordinates.map(line =>
                    line.map(c => ({ lat: c[1], lng: c[0] }))
                );
            }

            paths.forEach(path => {
                const polyline = new google.maps.Polyline({
                    path: path,
                    strokeOpacity: 0,
                    icons: [{
                        icon: {
                            path: google.maps.SymbolPath.CIRCLE,
                            fillColor: color,
                            fillOpacity: 1,
                            strokeWeight: 0,
                            scale: weight / 2,
                        },
                        offset: '0',
                        repeat: (weight * 2.0) + 'px'
                    }],
                    clickable: false,
                    map: googleMap,
                    zIndex: 119
                });
                window.upcPolylines.push({
                    polyline: polyline,
                    featureId: featureId,
                    level: level,
                    color: color,
                    weight: weight
                });
            });
        });
    });
}

/**
 * 全 UPC Polyline の表示/非表示・スタイルを更新
 * レイヤー表示状態、ズームレベル、検索絞り込み、詳細ハイライトを考慮
 */
function updateUpcPolylines() {
    if (!window.upcPolylines) {
        createUpcPolylinesFromFeatures();
    }
    if (!window.upcPolylines) return;

    const isLayerVisible = mapState.isLayerVisible('upc');
    const mode = mapState.getMode();
    const detailInfo = mapState.getCurrentDetail();

    // 検索モード時: 表示対象の UPC ID リスト
    let searchVisibleIds = null;
    if (mode === 'search') {
        searchVisibleIds = (persistentSearchResult.upc_all || []).map(String);
    }

    window.upcPolylines.forEach(item => {
        let visible = isLayerVisible;

        // レベルに応じたズーム判定
        if (visible && item.level === 1 && !mapState.isZoomOver(8)) visible = false;
        if (visible && item.level === 2 && !mapState.isZoomOver(10)) visible = false;

        // 検索モード絞り込み
        if (visible && searchVisibleIds !== null) {
            visible = searchVisibleIds.includes(item.featureId);
        }

        // ハイライト判定
        let color = item.color;
        let weight = item.weight;
        let zIndex = 119;

        if (visible && (mode === 'detail' || mode === 'geojson-detail') &&
            detailInfo.type === 'upc' && item.featureId === detailInfo.id) {
            color = '#FFFF00';
            weight = item.weight + 2;
            zIndex = 121;
        }

        item.polyline.setVisible(visible);
        if (visible) {
            item.polyline.setOptions({
                icons: [{
                    icon: {
                        path: google.maps.SymbolPath.CIRCLE,
                        fillColor: color,
                        fillOpacity: 1,
                        strokeWeight: 0,
                        scale: weight / 2,
                    },
                    offset: '0',
                    repeat: (weight * 2.0) + 'px'
                }],
                zIndex: zIndex
            });
        }
    });
}

// --- ▼▼▼ 以下、ポップアップ関連のクラス定義 (変更なし) ▼▼▼ ---

/**
 * 送電線用の単一・共有カスタムポップアップ
 */
class CustomLinePopup extends google.maps.OverlayView {
    constructor(googleMap) {
        super();
        this.map = googleMap;
        this.div = null;
        this.currentTarget = null;
        this.setMap(googleMap);
    }
    onAdd() {
        this.div = document.createElement('div');
        this.div.className = "geo-popup-container";
        this.div.style.cssText = "position: absolute; display: none; z-index: 1000;";
        this.getPanes().floatPane.appendChild(this.div);
    }
    show(latLng, properties) {
        if (!this.div) return;
        window.substationPopup?.hidePopup();
        this.currentTarget = properties;
        let linename = properties["PowerLine"] || "不明";
        if (properties["N_Ctmr"] === 1 || properties["N_Ctmr"] === true) {
            linename = "お客さま接続線（当社設備）";
        }
        const voltage = properties["Voltage"] ? ` ${properties["Voltage"]}kV` : '';
        const ordcurRank = getRankOfMv(properties["N_OrdCur"], properties["N_crgCtrl"]);
        const ordcur = properties["N_OrdCur"] !== null ? ` ${textForOrdCurRank[ordcurRank]}` : ' 要照会';
        this.div.innerHTML = `<div class="geo-pupup line-popup rank${ordcurRank}"><div class="line-info">${linename}${voltage}${ordcur}</div></div>`;
        const projection = this.getProjection();
        if (!projection) return;
        const pixelPosition = projection.fromLatLngToDivPixel(latLng);
        if (pixelPosition) {
            this.div.style.left = `${pixelPosition.x + 10}px`;
            this.div.style.top = `${pixelPosition.y - 15}px`;
            this.div.style.display = "block";
        }
    }
    hide() { if (this.div) { this.div.style.display = "none"; this.currentTarget = null; } }
    isVisible() { return this.div && this.div.style.display === "block"; }
    isSameTarget(properties) { return this.currentTarget && this.currentTarget.PowerLine === properties.PowerLine; }
    onRemove() { if (this.div) { this.div.remove(); this.div = null; } }
    draw() {}
}

/**
 * 工業団地用のカスタムポップアップOverlayView
 */
class CustomPolygonPopup extends google.maps.OverlayView {
    constructor(googleMap, properties) {
        super();
        this.properties = properties;
        this.div = null;
        this.map = googleMap;
        this.setMap(googleMap);
    }
    onAdd() {
        this.div = document.createElement('div');
        this.div.className = "geo-popup-container";
        this.div.style.cssText = "position: absolute; display: none; z-index: 1000;";
        this.div.innerHTML = `<div class="geo-popup polygon-popup"><div class="polygon-info">${this.properties["L05_002"] || "Unknown"}</div></div>`;
        this.getPanes().floatPane.appendChild(this.div);
    }
    updatePosition(latLng) {
        if (!this.div || !latLng) return;
        const projection = this.getProjection();
        const pixelPosition = projection.fromLatLngToDivPixel(latLng);
        if (!pixelPosition) return;
        this.div.style.left = `${pixelPosition.x + 5}px`;
        this.div.style.top = `${pixelPosition.y - 38}px`;
    }
    showPopup() { if (this.div) this.div.style.display = "block"; }
    hidePopup() { if (this.div) this.div.style.display = "none"; }
    onRemove() { if (this.div) { this.div.remove(); this.div = null; } }
    draw() {}
}

/**
 * 変電所など点データ用のカスタムポップアップOverlayView
 */
class CustomPointPopup extends google.maps.OverlayView {
    constructor(googleMap) {
        super();
        this.div = null; this.map = googleMap; this.setMap(googleMap);
    }
    onAdd() {
        this.div = document.createElement('div');
        this.div.className = "geo-popup-container";
        this.div.style.cssText = "position: absolute; display: none; z-index: 1000;";
        this.getPanes().floatPane.appendChild(this.div);
    }
    setContent(properties) {
        const linename = properties["変電所名"];
        const linenameSub = substationSubName[properties.Type] || '変電所';
        const voltage = properties["一次側"] ? ` ${properties["一次側"]}kV` : '';
        // const ordcurRank = getRankOfMv(properties["空容量"], 0);
        // const ordcur = (properties["空容量"] !== null && properties["空容量"] !== undefined) ? ` ${textForOrdCurRank[ordcurRank]}` : ' 要照会';
        // this.div.innerHTML = `<div class="geo-pupup substation-popup rank${ordcurRank}"><div class="line-info">${linename}${linenameSub}${voltage}${ordcur}</div></div>`;
        const ordcur = ' 要照会';
        this.div.innerHTML = `<div class="geo-pupup substation-popup rank0"><div class="line-info">${linename}${linenameSub}${voltage}${ordcur}</div></div>`;
    }
    updatePosition(latLng) {
        if (!this.div || !latLng) return;
        const projection = this.getProjection();
        if (!projection) return;
        const pixelPosition = projection.fromLatLngToDivPixel(latLng);
        if (!pixelPosition) return;
        const popupWidth = this.div.offsetWidth;
        this.div.style.left = `${pixelPosition.x - (popupWidth / 2)}px`;
        this.div.style.top = `${pixelPosition.y - 38}px`;
    }
    showPopup() { if (this.div) this.div.style.display = "block"; }
    hidePopup() { if (this.div) this.div.style.display = "none"; }
    onRemove() { if (this.div) { this.div.remove(); this.div = null; } }
    draw() {}
}
