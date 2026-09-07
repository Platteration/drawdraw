/**
 * Sketchbook palette — warm paper and graphite rather than the usual
 * dark-slate app chrome. The app should feel like a studio tool sitting
 * next to your drawing, not like software.
 */
export const colors = {
  paper: '#f4efe6',
  paperDeep: '#e8e0d2',
  paperEdge: '#d8cdb9',
  graphite: '#2e2a26',
  graphiteSoft: '#6d6459',
  graphiteFaint: '#9c9285',
  ink: '#1f1c19',
  accent: '#b4543a', // sanguine / red chalk
  accentSoft: '#e2c4ba',
  canvasMat: '#3a352f', // surround behind the photo
};

/** Guide line colors, named the way an artist would reach for them. */
export const GUIDE_COLORS = [
  { name: 'Sanguine', value: '#b4543a' },
  { name: 'Graphite', value: '#3d3833' },
  { name: 'Blue', value: '#3f6fb0' },
  { name: 'Chalk', value: '#f7f3ec' },
  { name: 'Sap', value: '#5d7f4e' },
];

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
};

export const type = {
  title: { fontSize: 17, fontWeight: '700', color: colors.graphite, letterSpacing: 0.2 },
  body: { fontSize: 13, lineHeight: 19, color: colors.graphiteSoft },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
};
