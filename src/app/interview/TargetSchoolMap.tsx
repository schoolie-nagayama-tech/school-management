'use client';

/**
 * ④「志望校と提案」の地図（台本の右の列）。教室の最寄り駅と、表に並んだ高校だけにピンを立てる。
 *
 * ★地図は国土地理院の地理院タイル（無料・APIキー不要）。Google マップの埋め込みは、
 *   ピンを自由に立てるのにAPIキーと課金が要るので使わない（2026-09-24 ユーザーと合意）。
 *   経路は地図に描かず、表の「通学」に文字で出すだけ。
 * ★leaflet は window を触るので、描画後に動的 import する（サーバー描画で落とさない）。
 * ★列の幅が決まる前（幅0〜数十px）に全体を収めると縮尺を誤る（モックで実際に起きた）。
 *   ResizeObserver で幅が変わるたびに測り直し、講師が地図を動かすまでは全校が収まる縮尺に戻す。
 * ★ピンの色は CSS のクラスで付ける。SVG の属性には var(--danger) が効かないため。
 */
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import type { Map as LeafletMap, CircleMarker } from 'leaflet';
import type { ProposalOrigin, ProposalRow } from '@/lib/interview/targetProposals';
import { PROPOSAL_BAND_LABEL } from '@/lib/interview/targetProposals';

const PIN_CLASS = {
  challenge: 'fill-danger stroke-surface',
  fit: 'fill-info stroke-surface',
  safe: 'fill-success stroke-surface',
} as const;
const PIN_CLASS_NO_BAND = 'fill-text-muted stroke-surface';

/** ポップアップに入れる文字列の最小限のエスケープ（学校名・沿線はマスタ由来だが念のため） */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function TargetSchoolMap({
  rows,
  origin,
  selectedId,
}: {
  rows: ProposalRow[];
  origin: ProposalOrigin | null;
  selectedId: string | null;
}) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<Map<string, CircleMarker>>(new Map());
  // 講師が地図を動かしたか。動かしたあとは幅が変わっても縮尺を戻さない
  const touchedRef = useRef(false);

  const withPos = rows.filter((r) => r.school.lat != null && r.school.lon != null);
  // 行の中身が同じなら地図を作り直さない（親の再描画のたびにピンを立て直すと、開いた吹き出しが閉じる）
  const key =
    (origin ? `${origin.lat},${origin.lon}|` : '') +
    withPos.map((r) => `${r.school.id}:${r.band ?? ''}:${r.rank ?? ''}`).join(',');

  useEffect(() => {
    const node = el.current;
    if (!node || withPos.length === 0) return;
    let disposed = false;
    let observer: ResizeObserver | null = null;

    void import('leaflet').then((mod) => {
      if (disposed) return;
      const L = mod.default ?? mod;
      const map = L.map(node, { scrollWheelZoom: false });
      mapRef.current = map;
      touchedRef.current = false;
      L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution:
          '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">地理院タイル</a>',
      }).addTo(map);

      const points: [number, number][] = [];
      if (origin) {
        points.push([origin.lat, origin.lon]);
        L.marker([origin.lat, origin.lon], {
          zIndexOffset: 1000,
          icon: L.divIcon({
            className: '',
            html:
              '<div class="h-3 w-3 border-2 border-surface bg-text-heading"></div>' +
              `<div class="-mt-3 ml-4 whitespace-nowrap text-[10.5px] font-bold text-text-heading">${esc(origin.name)}</div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6],
          }),
        }).addTo(map);
      }

      const markers = new Map<string, CircleMarker>();
      for (const r of withPos) {
        const latlng: [number, number] = [r.school.lat as number, r.school.lon as number];
        points.push(latlng);
        // 登録済みの志望校は外側にリングを重ねて見分ける
        if (r.rank != null) {
          L.circleMarker(latlng, {
            radius: 11,
            weight: 2,
            fill: false,
            interactive: false,
            className: 'stroke-text-heading',
          }).addTo(map);
        }
        const bandLabel = r.band ? PROPOSAL_BAND_LABEL[r.band] : '';
        const name = r.school.course
          ? `${r.school.schoolName}（${r.school.course}）`
          : r.school.schoolName;
        const m = L.circleMarker(latlng, {
          radius: 6,
          weight: 2,
          fillOpacity: 1,
          className: r.band ? PIN_CLASS[r.band] : PIN_CLASS_NO_BAND,
        })
          .bindTooltip(esc(name), { direction: 'top', offset: [0, -5] })
          .bindPopup(
            `<b>${esc(name)}</b> ${esc(bandLabel)}${r.rank != null ? ` ・第${r.rank}志望` : ''}` +
              (r.commute ? `<br>${esc(r.commute)}` : '')
          )
          .addTo(map);
        markers.set(r.school.id, m);
      }
      markersRef.current = markers;
      map.on('dragstart', () => {
        touchedRef.current = true;
      });

      const fit = () => {
        if (node.clientWidth < 100) return;
        map.invalidateSize();
        if (touchedRef.current) return;
        if (points.length === 1) map.setView(points[0], 13, { animate: false });
        else map.fitBounds(points, { padding: [16, 16], animate: false });
      };
      fit();
      observer = new ResizeObserver(fit);
      observer.observe(node);
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current = new Map();
    };
    // key に rows・origin の中身をまとめてある
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // 表の行を押したら、その学校へ寄せて吹き出しを開く
  useEffect(() => {
    if (!selectedId) return;
    const map = mapRef.current;
    const m = markersRef.current.get(selectedId);
    if (!map || !m) return;
    touchedRef.current = true;
    map.setView(m.getLatLng(), 13, { animate: true });
    m.openPopup();
  }, [selectedId]);

  if (withPos.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-bold tracking-[0.14em] text-text-muted">地図</span>
      {/* ★isolate: leaflet の z-index（400〜1000）が台本の外（ヘッダー・モーダル）に重ならないように閉じ込める */}
      <div
        ref={el}
        className="isolate h-[280px] w-full overflow-hidden rounded-lg border border-border"
      />
      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10.5px] text-text-muted">
        {origin && (
          <span className="inline-flex items-center gap-1">
            <i className="inline-block h-2 w-2 bg-text-heading" />
            {origin.name}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <i className="inline-block h-2 w-2 rounded-full bg-danger" />
          挑戦
        </span>
        <span className="inline-flex items-center gap-1">
          <i className="inline-block h-2 w-2 rounded-full bg-info" />
          順当
        </span>
        <span className="inline-flex items-center gap-1">
          <i className="inline-block h-2 w-2 rounded-full bg-success" />
          安全
        </span>
        <span className="inline-flex items-center gap-1">
          <i className="inline-block h-2 w-2 rounded-full border-2 border-text-heading" />
          志望校
        </span>
      </div>
    </div>
  );
}
