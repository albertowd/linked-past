// Draws the 32x32 pixel-art app icon (shield, sword, L, Wi-Fi) into public/icons:
// icon.svg as merged pixel rows, plus nearest-neighbour PNGs when rsvg-convert and magick exist.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const N = 32;
const C = {
  K: '#181838', // background and outlines
  W: '#f8f8f8', // shield rim
  B: '#2858b8', // shield face
  b: '#183c90', // shield shade
  Y: '#f8d830', // gold
  y: '#b07818', // gold shade
  S: '#e8f0f8', // blade
  s: '#8890b0', // fuller
  P: '#6838a0', // grip
  p: '#40207a', // grip shade
  G: '#78f878', // Wi-Fi
};
const g = Array.from({ length: N }, () => new Array(N).fill('K'));
const set = (x, y, c) => {
  if (x >= 0 && y >= 0 && x < N && y < N) g[y][x] = c;
};
const key = (x, y) => `${x},${y}`;
const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// Everything is centred on columns 15-16 and stacked back to front: shield, sword, L.
const outline = (pixels) => {
  const inside = new Set(pixels.map(([x, y]) => key(x, y)));
  for (const [x, y] of pixels)
    for (const [dx, dy] of N4) if (!inside.has(key(x + dx, y + dy))) set(x + dx, y + dy, 'K');
};

// Shield: flat top, straight sides, tapering to a point; rim on every pixel touching the outside.
const rows = [];
for (let y = 7; y <= 20; y++) rows.push([y, 5, 26]);
for (let inset = 1; inset <= 10; inset++) rows.push([20 + inset, 5 + inset, 26 - inset]);
const shield = new Set();
for (const [y, a, b] of rows) for (let x = a; x <= b; x++) shield.add(key(x, y));
for (const k of shield) {
  const [x, y] = k.split(',').map(Number);
  const rim = N4.some(([dx, dy]) => !shield.has(key(x + dx, y + dy)));
  const face = x >= 22 ? 'b' : 'B'; // right side in shade
  set(x, y, rim ? 'W' : face);
}

// Sword in front of the shield: hilt above it, tip down and ending inside it.
const sword = [];
sword.push([15, 0, 'Y'], [16, 0, 'y']);
for (let y = 1; y <= 3; y++) sword.push([15, y, 'P'], [16, y, 'p']);
for (let x = 11; x <= 20; x++) sword.push([x, 4, 'Y'], [x, 5, 'y']);
for (let y = 6; y <= 26; y++) sword.push([14, y, 'S'], [15, y, 's'], [16, y, 's'], [17, y, 'S']);
sword.push([15, 27, 'S'], [16, 27, 'S']);
outline(sword);
for (const [x, y, c] of sword) set(x, y, c);

// L in front of the sword, its bounding box centred, with a one-pixel drop shadow.
const L = [];
for (let y = 9; y <= 21; y++) L.push([11, y], [12, y]);
for (let x = 13; x <= 20; x++) L.push([x, 20], [x, 21]);
const inL = new Set(L.map(([x, y]) => key(x, y)));
const shadow = L.map(([x, y]) => [x + 1, y + 1]).filter(([x, y]) => !inL.has(key(x, y)));
outline([...L, ...shadow]);
for (const [x, y] of shadow) set(x, y, 'y');
for (const [x, y] of L) set(x, y, 'Y');

// Wi-Fi in the top-left corner.
const wifi = ['..######..', '.#......#.', '#..####..#', '..#....#..', '....##....', '....##....'];
wifi.forEach((row, dy) => {
  [...row].forEach((ch, dx) => {
    if (ch === '#') set(1 + dx, 1 + dy, 'G');
  });
});

let rects = '';
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; ) {
    let e = x;
    while (e + 1 < N && g[y][e + 1] === g[y][x]) e++;
    if (g[y][x] !== 'K') rects += `  <rect x="${x}" y="${y}" width="${e - x + 1}" height="1" fill="${C[g[y][x]]}"/>\n`;
    x = e + 1;
  }
}
const out = new URL('../public/icons/', import.meta.url).pathname;
writeFileSync(
  `${out}icon.svg`,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges" role="img" aria-labelledby="t">
  <title id="t">Linked Past</title>
  <rect width="${N}" height="${N}" fill="${C.K}"/>
${rects}</svg>
`,
);
for (const size of [192, 512])
  execSync(
    `rsvg-convert -w ${N} -h ${N} icon.svg | magick - -alpha off -filter point -resize ${size}x${size} PNG24:icon-${size}.png`,
    { cwd: out },
  );
console.log(`icons written to ${out}`);
