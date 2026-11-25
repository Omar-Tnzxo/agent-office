import { BALCONY, DANCE_FLOOR, FIRE_PIT, FLOOR, LOFT, MEETING_ROOM, ROOF_BAR, ROOF_TABLES, SEATING_BY_ID, STAGE, WING, inWing, seatAt } from '../../shared/layout';
import type { PeerInfo } from '../../shared/protocol';
import { ROOF } from '../../shared/rooftop';
import { CARS, type CarSeat } from '../../shared/garage';
import { seatOn, type MapPlan } from '../../shared/maps';
import { store } from '../state';
import { t } from '../i18n';
import { serverText } from '../i18n/server';

/**
 * What a teammate is up to, for the line under their name tag and in the sidebar: whatever they have
 * open ("💻 in Pixel's terminal", "🔀 reading PR #12"), else somewhere worth saying they are ("🌇 on
 * the balcony", "🛋️ on the couch", "🏎️ driving the Orange Lambo"). Nothing while they're just walking around
 * the office.
 */
export function whereabouts(p: PeerInfo, car?: { car: number; seat: CarSeat }, plan: MapPlan = store.plan()): string | undefined {
  // A teammate's own words, sent in English: said in this viewer's language where a rule knows them.
  if (p.doing) return serverText(p.doing);
  // Not standing anywhere: in on the 2D view, from a phone, say.
  if (p.lite) return t('panels.wb.lite');
  // In one of the garage's cars (see Store.carOf).
  const def = car && CARS[car.car];
  if (def) return t(car.seat === 'driver' ? 'panels.wb.driving' : 'panels.wb.riding', { car: def.name });
  if (p.smoking) return t('panels.wb.smoke');
  if (p.golfing) return t('panels.wb.golf');
  if (p.throwing) return t(p.throwing === 'darts' ? 'panels.wb.darts' : 'panels.wb.axes');
  const office = plan.style === 'office' || p.floor === ROOF;
  const place = p.seat ? (office ? seatAt(p.seat) : seatOn(plan, p.seat)) : undefined;
  const seat = place && (office ? SEATING_BY_ID : plan.seatingById).get(place.seatId);
  if (seat) {
    // "🛋️ Couch" -> "🛋️ on the couch".
    const [icon, ...name] = seat.label.split(' ');
    return t(seat.game ? 'panels.wb.seatIn' : 'panels.wb.seatOn', { icon, place: name.join(' ').toLowerCase() });
  }
  // The roof is the office's size, but none of its rooms are up there.
  if (p.floor === ROOF) return onTheRoof(p);
  // On a map of its own, the office's rooms aren't where they'd be.
  if (!office) return undefined;
  // Through the north wall in the back office: nobody gets there unless the floor's built out.
  if (p.y > -1 && inWing(p.x, p.z, WING.rows)) return t('panels.wb.backOffice');
  // Down on the street, or out the back door on the stairs down to it.
  if (p.y < -1 || p.x < FLOOR.minX || p.x > FLOOR.maxX || p.z < FLOOR.minZ) return t('panels.wb.outside');
  if (p.z > FLOOR.maxZ) return t(p.x >= BALCONY.minX && p.x <= BALCONY.maxX ? 'panels.wb.balcony' : 'panels.wb.outside');
  if (p.y > LOFT.y - 0.5 && p.x > LOFT.minX && p.z > LOFT.minZ) return t('panels.wb.boss');
  if (p.x > MEETING_ROOM.minX && p.z > MEETING_ROOM.minZ) return t('panels.wb.meeting');
  return undefined;
}

/** Somewhere on the rooftop bar worth saying they are, standing up. */
function onTheRoof(p: PeerInfo): string | undefined {
  if (p.x > STAGE.minX && p.x < STAGE.maxX && p.z < STAGE.maxZ) return t('panels.wb.stage');
  if (p.x > DANCE_FLOOR.minX && p.x < DANCE_FLOOR.maxX && p.z > DANCE_FLOOR.minZ && p.z < DANCE_FLOOR.maxZ) return t('panels.wb.dance');
  if (p.x > ROOF_BAR.x - 2.5 && p.z > ROOF_BAR.minZ - 0.5 && p.z < ROOF_BAR.maxZ + 0.5) return t('panels.wb.bar');
  if (ROOF_TABLES.some((tb) => Math.hypot(p.x - tb.x, p.z - tb.z) < 1.3)) return t('panels.wb.table');
  if (Math.hypot(p.x - FIRE_PIT.x, p.z - FIRE_PIT.z) < 3.5) return t('panels.wb.fire');
  return undefined;
}
