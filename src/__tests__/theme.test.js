import { colors } from '../theme';

function luminance(hex) {
  const linear = hex.match(/[a-f\d]{2}/gi).map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

// These combinations cover labels, inactive chips, paywall cards, links and
// primary buttons (the paper/accent ratio is symmetric). Disabled controls
// are separately marked disabled and are exempt from the AA text minimum.
it.each([
  ['graphite', 'paper'], ['graphite', 'paperDeep'],
  ['graphiteSoft', 'paper'], ['graphiteSoft', 'paperDeep'],
  ['graphiteFaint', 'paper'], ['graphiteFaint', 'paperDeep'],
  ['accent', 'paper'], ['accent', 'paperDeep'],
])('keeps active %s text on %s at WCAG AA contrast', (foreground, background) => {
  const a = luminance(colors[foreground]);
  const b = luminance(colors[background]);
  expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
});
