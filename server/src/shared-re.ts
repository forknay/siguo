// Centralized re-exports from @siguo/shared used by the server. Also defines a
// runtime list of seat ids (since the shared package's `ZONES` is a const array).

export { ClientMessage, type ServerMessage, type SeatId } from '@siguo/shared';

export const ZONES_ALIAS: ['N', 'E', 'S', 'W'] = ['N', 'E', 'S', 'W'];
