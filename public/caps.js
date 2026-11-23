// AMWA BCP-004-01 Receiver Capabilities evaluation (shared by server and browser).
//
// Semantics (BCP-004-01 v1.0):
//   - caps.media_types: satisfied when the Flow media_type matches ANY entry (IS-04).
//   - caps.constraint_sets: satisfied when ANY Constraint Set is satisfied; an empty
//     array is never satisfied; an absent attribute means unconstrained.
//   - A Constraint Set is satisfied when ALL its Parameter Constraints are satisfied.
//   - A Parameter Constraint is satisfied when ALL its keywords hold: enum, minimum,
//     maximum (inclusive). Rationals compare by cross-multiplication.
//   - Sets with urn:x-nmos:cap:meta:enabled === false are not considered.
//   - Unrecognised parameters are ignored; a set in which nothing can be evaluated
//     is considered satisfied. A parameter the Sender does not describe is also
//     not evaluable, so it is ignored (and reported as such).
// Capability URNs follow the NMOS Capabilities register.

const META = 'urn:x-nmos:cap:meta:';
export const CAP = {
  mediaType: 'urn:x-nmos:cap:format:media_type',
  grainRate: 'urn:x-nmos:cap:format:grain_rate',
  frameWidth: 'urn:x-nmos:cap:format:frame_width',
  frameHeight: 'urn:x-nmos:cap:format:frame_height',
  interlaceMode: 'urn:x-nmos:cap:format:interlace_mode',
  colorspace: 'urn:x-nmos:cap:format:colorspace',
  transferCharacteristic: 'urn:x-nmos:cap:format:transfer_characteristic',
  colorSampling: 'urn:x-nmos:cap:format:color_sampling',
  componentDepth: 'urn:x-nmos:cap:format:component_depth',
  componentRange: 'urn:x-nmos:cap:format:component_range',
  formatBitRate: 'urn:x-nmos:cap:format:bit_rate',
  profile: 'urn:x-nmos:cap:format:profile',
  level: 'urn:x-nmos:cap:format:level',
  sublevel: 'urn:x-nmos:cap:format:sublevel',
  channelCount: 'urn:x-nmos:cap:format:channel_count',
  sampleRate: 'urn:x-nmos:cap:format:sample_rate',
  sampleDepth: 'urn:x-nmos:cap:format:sample_depth',
  eventType: 'urn:x-nmos:cap:format:event_type',
  transportBitRate: 'urn:x-nmos:cap:transport:bit_rate',
  packetTransmissionMode: 'urn:x-nmos:cap:transport:packet_transmission_mode',
  st2110_21SenderType: 'urn:x-nmos:cap:transport:st2110_21_sender_type',
  hkep: 'urn:x-nmos:cap:transport:hkep',
  privacy: 'urn:x-nmos:cap:transport:privacy',
};
const RATIONAL = new Set([CAP.grainRate, CAP.sampleRate]);
export const KNOWN_CAPS = new Set(Object.values(CAP));
const SHORT = Object.fromEntries(Object.entries(CAP).map(([, urn]) => [urn, urn.split(':').pop()]));
export const capLabel = urn => SHORT[urn] || urn.replace(/^urn:x-nmos:cap:/, '');

function isRational(v) { return v && typeof v === 'object' && Number.isInteger(v.numerator); }
function rat(v) { return isRational(v) ? {n: v.numerator, d: Number.isInteger(v.denominator) && v.denominator > 0 ? v.denominator : 1} : null; }
/** Compare rationals by cross-multiplication: <0, 0, >0. */
export function compareRational(a, b) { const x = rat(a), y = rat(b); return x.n * y.d - y.n * x.d; }
export function formatValue(v) { if (isRational(v)) { const r = rat(v); return r.d === 1 ? String(r.n) : `${r.n}/${r.d}`; } return Array.isArray(v) ? v.map(formatValue).join(', ') : String(v); }

/** Evaluate one Parameter Constraint against one Sender value. */
export function checkConstraint(urn, constraint, value) {
  if (!constraint || typeof constraint !== 'object') return {ok: true};
  const rational = RATIONAL.has(urn) || isRational(value);
  if (rational && !isRational(value)) return {ok: false, why: 'not a rational'};
  if (Array.isArray(constraint.enum)) {
    const hit = constraint.enum.some(e => rational ? isRational(e) && compareRational(e, value) === 0 : e === value);
    if (!hit) return {ok: false, why: `${formatValue(value)} not in {${constraint.enum.map(formatValue).join(', ')}}`};
  }
  if (constraint.minimum !== undefined) {
    const below = rational ? isRational(constraint.minimum) && compareRational(value, constraint.minimum) < 0 : typeof value === 'number' && value < constraint.minimum;
    if (below) return {ok: false, why: `${formatValue(value)} < minimum ${formatValue(constraint.minimum)}`};
  }
  if (constraint.maximum !== undefined) {
    const above = rational ? isRational(constraint.maximum) && compareRational(value, constraint.maximum) > 0 : typeof value === 'number' && value > constraint.maximum;
    if (above) return {ok: false, why: `${formatValue(value)} > maximum ${formatValue(constraint.maximum)}`};
  }
  return {ok: true};
}

/**
 * Evaluate a Receiver's caps against a Sender's parameter values
 * ({[capUrn]: value}). Returns
 *   {ok, evaluated, reason, mediaTypes:{ok,...}|null, sets:[{index,label,enabled,ok,checked:[...],ignored:[...]}], matchedSet}
 * `evaluated` is false when the Receiver declares no caps we can use.
 */
export function evaluateCaps(caps, params) {
  params = params || {};
  const result = {ok: true, evaluated: false, reason: '', mediaTypes: null, sets: [], matchedSet: null};
  if (!caps || typeof caps !== 'object') return result;
  if (Array.isArray(caps.media_types) && caps.media_types.length) {
    const mt = params[CAP.mediaType];
    result.evaluated = true;
    result.mediaTypes = mt === undefined ? {ok: true, ignored: true, accepts: caps.media_types} : {ok: caps.media_types.includes(mt), value: mt, accepts: caps.media_types};
    if (!result.mediaTypes.ok) { result.ok = false; result.reason = `media type ${mt} not accepted (${caps.media_types.join(', ')})`; }
  }
  if (!Array.isArray(caps.constraint_sets)) return result;
  result.evaluated = true;
  const sets = caps.constraint_sets.map((set, index) => {
    const label = typeof set?.[META + 'label'] === 'string' ? set[META + 'label'] : `Constraint set ${index + 1}`;
    const enabled = set?.[META + 'enabled'] !== false;
    const checked = [], ignored = [];
    for (const [urn, constraint] of Object.entries(set || {})) {
      if (urn.startsWith(META)) continue;
      if (!KNOWN_CAPS.has(urn)) { ignored.push({urn, why: 'unrecognised parameter'}); continue; }
      if (params[urn] === undefined) { ignored.push({urn, why: 'not described by the sender'}); continue; }
      checked.push({urn, value: params[urn], constraint, ...checkConstraint(urn, constraint, params[urn])});
    }
    // A set in which nothing could be evaluated is considered satisfied.
    return {index, label, enabled, preference: Number.isInteger(set?.[META + 'preference']) ? set[META + 'preference'] : 0, ok: enabled && checked.every(c => c.ok), checked, ignored};
  });
  result.sets = sets;
  const candidates = sets.filter(s => s.enabled);
  const satisfied = candidates.filter(s => s.ok).sort((a, b) => b.preference - a.preference);
  result.matchedSet = satisfied[0] ? satisfied[0].index : null;
  if (!satisfied.length) {
    result.ok = false;
    if (!result.reason) {
      if (!caps.constraint_sets.length) result.reason = 'receiver declares an empty constraint_sets list';
      else if (!candidates.length) result.reason = 'every constraint set is disabled';
      else {
        // Explain with the set that came closest (fewest failing constraints).
        const best = [...candidates].sort((a, b) => a.checked.filter(c => !c.ok).length - b.checked.filter(c => !c.ok).length)[0];
        result.reason = best.checked.filter(c => !c.ok).map(c => `${capLabel(c.urn)} ${c.why}`).join('; ') + (candidates.length > 1 ? ` (closest of ${candidates.length} constraint sets: ${best.label})` : '');
      }
    }
  }
  return result;
}

/**
 * Sender parameter values for capability evaluation, derived from the IS-04
 * Sender, its Flow and its Source, per the Capabilities register targets.
 */
export function senderParams(sender, flow, source) {
  const p = {};
  const put = (urn, v) => { if (v !== undefined && v !== null && v !== '') p[urn] = v; };
  if (flow) {
    put(CAP.mediaType, flow.media_type);
    put(CAP.grainRate, flow.grain_rate || source?.grain_rate);
    put(CAP.frameWidth, flow.frame_width); put(CAP.frameHeight, flow.frame_height);
    put(CAP.interlaceMode, flow.interlace_mode); put(CAP.colorspace, flow.colorspace);
    put(CAP.transferCharacteristic, flow.transfer_characteristic); put(CAP.componentRange, flow.component_range);
    put(CAP.formatBitRate, flow.bit_rate); put(CAP.profile, flow.profile); put(CAP.level, flow.level); put(CAP.sublevel, flow.sublevel);
    put(CAP.sampleRate, flow.sample_rate); put(CAP.sampleDepth, flow.bit_depth); put(CAP.eventType, flow.event_type);
    if (Array.isArray(flow.components) && flow.components.length) {
      put(CAP.componentDepth, flow.components[0].bit_depth);
      put(CAP.colorSampling, colorSampling(flow.components));
    }
  }
  if (source && Array.isArray(source.channels)) put(CAP.channelCount, source.channels.length);
  if (sender) {
    put(CAP.transportBitRate, sender.bit_rate); put(CAP.packetTransmissionMode, sender.packet_transmission_mode);
    put(CAP.st2110_21SenderType, sender.st2110_21_sender_type); put(CAP.hkep, sender.hkep); put(CAP.privacy, sender.privacy);
  }
  return p;
}

/** Map IS-04 Flow components to an SDP-style sampling string (e.g. YCbCr-4:2:2). */
export function colorSampling(components) {
  const by = Object.fromEntries(components.map(c => [c.name, c]));
  const ratio = (y, c) => !y || !c ? null : c.width === y.width && c.height === y.height ? '4:4:4' : c.width * 2 === y.width && c.height === y.height ? '4:2:2' : c.width * 2 === y.width && c.height * 2 === y.height ? '4:2:0' : c.width * 4 === y.width && c.height === y.height ? '4:1:1' : null;
  if (by.Y && by.Cb && by.Cr) { const r = ratio(by.Y, by.Cb); return r ? 'YCbCr-' + r : undefined; }
  if (by.R && by.G && by.B) return 'RGB';
  if (by.X && by.Y && by.Z) return 'XYZ';
  if (by.I && by.Ct && by.Cp) { const r = ratio(by.I, by.Ct); return r ? 'ICtCp-' + r : undefined; }
  return undefined;
}
