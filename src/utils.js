export const run = (fn) => fn();
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const seededRandom = (seed) => {
    const x = Math.sin(seed * 9999) * 10000;
    return x - Math.floor(x);
};
export const hashString = (str) => {
    let h = 0;
    for (let i = 0; i < str.length; i++)
        h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return Math.abs(h);
};
