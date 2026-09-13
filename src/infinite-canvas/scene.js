import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { KeyboardControls, Stats, useKeyboardControls, useProgress } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as React from "react";
import * as THREE from "three";
import { useIsTouchDevice } from "../use-is-touch-device.js";
import { clamp, lerp } from "../utils.js";
import { CHUNK_FADE_MARGIN, CHUNK_OFFSETS, CHUNK_SIZE, DEPTH_FADE_END, DEPTH_FADE_START, INITIAL_CAMERA_Z, INVIS_THRESHOLD, KEYBOARD_SPEED, MAX_VELOCITY, RENDER_DISTANCE, VELOCITY_DECAY, VELOCITY_LERP, } from "./constants.js";
import styles from "./style.module.js";
import { getTexture } from "./texture-manager.js";
import { generateChunkPlanesCached, getChunkUpdateThrottleMs, shouldThrottleUpdate } from "./utils.js";
const PLANE_GEOMETRY = new THREE.PlaneGeometry(1, 1);
const KEYBOARD_MAP = [
    { name: "forward", keys: ["w", "W", "ArrowUp"] },
    { name: "backward", keys: ["s", "S", "ArrowDown"] },
    { name: "left", keys: ["a", "A", "ArrowLeft"] },
    { name: "right", keys: ["d", "D", "ArrowRight"] },
    { name: "up", keys: ["e", "E"] },
    { name: "down", keys: ["q", "Q"] },
];
const getTouchDistance = (touches) => {
    if (touches.length < 2) {
        return 0;
    }
    const [t1, t2] = touches;
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
};
function MediaPlane({ position, scale, media, chunkCx, chunkCy, chunkCz, cameraGridRef, onSelect, }) {
    const meshRef = React.useRef(null);
    const materialRef = React.useRef(null);
    const localState = React.useRef({ opacity: 0, frame: 0, ready: false });
    const [texture, setTexture] = React.useState(null);
    const [isReady, setIsReady] = React.useState(false);
    useFrame(() => {
        const material = materialRef.current;
        const mesh = meshRef.current;
        const state = localState.current;
        if (!material || !mesh) {
            return;
        }
        state.frame = (state.frame + 1) & 1;
        if (state.opacity < INVIS_THRESHOLD && !mesh.visible && state.frame === 0) {
            return;
        }
        const cam = cameraGridRef.current;
        const dist = Math.max(Math.abs(chunkCx - cam.cx), Math.abs(chunkCy - cam.cy), Math.abs(chunkCz - cam.cz));
        const absDepth = Math.abs(position.z - cam.camZ);
        if (absDepth > DEPTH_FADE_END + 50) {
            state.opacity = 0;
            material.opacity = 0;
            material.depthWrite = false;
            mesh.visible = false;
            return;
        }
        const gridFade = dist <= RENDER_DISTANCE ? 1 : Math.max(0, 1 - (dist - RENDER_DISTANCE) / Math.max(CHUNK_FADE_MARGIN, 0.0001));
        const depthFade = absDepth <= DEPTH_FADE_START
            ? 1
            : Math.max(0, 1 - (absDepth - DEPTH_FADE_START) / Math.max(DEPTH_FADE_END - DEPTH_FADE_START, 0.0001));
        const target = Math.min(gridFade, depthFade * depthFade);
        state.opacity = target < INVIS_THRESHOLD && state.opacity < INVIS_THRESHOLD ? 0 : lerp(state.opacity, target, 0.18);
        const isFullyOpaque = state.opacity > 0.99;
        material.opacity = isFullyOpaque ? 1 : state.opacity;
        material.depthWrite = isFullyOpaque;
        mesh.visible = state.opacity > INVIS_THRESHOLD;
    });
    // Calculate display scale from media dimensions (from manifest)
    const displayScale = React.useMemo(() => {
        if (media.width && media.height) {
            const aspect = media.width / media.height;
            return new THREE.Vector3(scale.y * aspect, scale.y, 1);
        }
        return scale;
    }, [media.width, media.height, scale]);
    // Load texture with onLoad callback
    React.useEffect(() => {
        const state = localState.current;
        state.ready = false;
        state.opacity = 0;
        setIsReady(false);
        const material = materialRef.current;
        if (material) {
            material.opacity = 0;
            material.depthWrite = false;
            material.map = null;
        }
        const tex = getTexture(media, () => {
            state.ready = true;
            setIsReady(true);
        });
        setTexture(tex);
    }, [media]);
    // Apply texture when ready
    React.useEffect(() => {
        const material = materialRef.current;
        const mesh = meshRef.current;
        const state = localState.current;
        if (!material || !mesh || !texture || !isReady || !state.ready) {
            return;
        }
        material.map = texture;
        material.opacity = state.opacity;
        material.depthWrite = state.opacity >= 1;
        mesh.scale.copy(displayScale);
    }, [displayScale, texture, isReady]);
    if (!texture || !isReady) {
        return null;
    }
    return (_jsx("mesh", { ref: meshRef, position: position, scale: displayScale, visible: false, geometry: PLANE_GEOMETRY, onClick: (event) => {
            event.stopPropagation();
            onSelect?.(position, displayScale, media);
        }, children: _jsx("meshBasicMaterial", { ref: materialRef, transparent: true, opacity: 0, side: THREE.DoubleSide }) }));
}
function Chunk({ cx, cy, cz, media, cameraGridRef, onSelect, }) {
    const [planes, setPlanes] = React.useState(null);
    React.useEffect(() => {
        let canceled = false;
        const run = () => !canceled && setPlanes(generateChunkPlanesCached(cx, cy, cz));
        if (typeof requestIdleCallback !== "undefined") {
            const id = requestIdleCallback(run, { timeout: 100 });
            return () => {
                canceled = true;
                cancelIdleCallback(id);
            };
        }
        const id = setTimeout(run, 0);
        return () => {
            canceled = true;
            clearTimeout(id);
        };
    }, [cx, cy, cz]);
    if (!planes) {
        return null;
    }
    return (_jsx("group", { children: planes.map((plane) => {
            const mediaItem = media[plane.mediaIndex % media.length];
            if (!mediaItem) {
                return null;
            }
            return (_jsx(MediaPlane, { position: plane.position, scale: plane.scale, media: mediaItem, chunkCx: cx, chunkCy: cy, chunkCz: cz, cameraGridRef: cameraGridRef, onSelect: onSelect }, plane.id));
        }) }));
}
const createInitialState = (camZ) => ({
    velocity: { x: 0, y: 0, z: 0 },
    targetVel: { x: 0, y: 0, z: 0 },
    basePos: { x: 0, y: 0, z: camZ },
    drift: { x: 0, y: 0 },
    mouse: { x: 0, y: 0 },
    lastMouse: { x: 0, y: 0 },
    scrollAccum: 0,
    isDragging: false,
    lastTouches: [],
    lastTouchDist: 0,
    lastChunkKey: "",
    lastChunkUpdate: 0,
    pendingChunk: null,
});
function projectPlaneRect(position, scale, camera, width, height) {
    const halfW = scale.x / 2;
    const halfH = scale.y / 2;
    const points = [
        new THREE.Vector3(position.x - halfW, position.y - halfH, position.z),
        new THREE.Vector3(position.x + halfW, position.y - halfH, position.z),
        new THREE.Vector3(position.x - halfW, position.y + halfH, position.z),
        new THREE.Vector3(position.x + halfW, position.y + halfH, position.z),
    ];
    const projected = points.map((point) => point.project(camera));
    const xs = projected.map((p) => (p.x * 0.5 + 0.5) * width);
    const ys = projected.map((p) => (-p.y * 0.5 + 0.5) * height);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    return { left, top, width: right - left, height: bottom - top };
}
function FocusTitle({ title, visible }) {
    const words = React.useMemo(() => title.trim().split(/\s+/).filter(Boolean), [title]);
    return (_jsx("div", { className: `${styles.focusTitle} ${visible ? styles.focusTitleVisible : ""}`, "aria-hidden": "true", children: _jsx("div", { className: styles.focusTitleClip, children: words.map((word, index) => (_jsx("span", { className: styles.focusWord, style: { transitionDelay: `${index * 70}ms` }, children: word }, `${word}-${index}`))) }) }));
}
function FocusOverlay({ focus, closing, onClose }) {
    const [titleVisible, setTitleVisible] = React.useState(false);
    const [opened, setOpened] = React.useState(false);
    const [imageReady, setImageReady] = React.useState(false);
    React.useEffect(() => {
        if (!focus)
            return;
        setOpened(false);
        setTitleVisible(false);
        setImageReady(false);
    }, [focus]);
    React.useEffect(() => {
        if (!focus || !imageReady)
            return;
        const frame = window.requestAnimationFrame(() => setOpened(true));
        return () => window.cancelAnimationFrame(frame);
    }, [focus, imageReady]);
    React.useEffect(() => {
        if (!focus || closing || !opened) {
            setTitleVisible(false);
            return;
        }
        const id = window.setTimeout(() => setTitleVisible(true), 500);
        return () => window.clearTimeout(id);
    }, [focus, closing, opened]);
    if (!focus)
        return null;
    const rect = focus.rect;
    const targetWidth = Math.min(window.innerWidth * 0.72, window.innerWidth - 32);
    const targetHeight = Math.min(window.innerHeight * 0.78, window.innerHeight - 32);
    const aspect = rect.height / Math.max(rect.width, 1);
    const fittedHeight = targetWidth * aspect;
    const finalWidth = fittedHeight > targetHeight ? targetHeight / aspect : targetWidth;
    const finalHeight = fittedHeight > targetHeight ? targetHeight : fittedHeight;
    const targetLeft = (window.innerWidth - finalWidth) / 2;
    const targetTop = (window.innerHeight - finalHeight) / 2;
    const expanded = opened && !closing;
    return (_jsxs("div", { className: `${styles.focusLayer} ${expanded ? styles.focusLayerOpen : ""} ${closing ? styles.focusLayerClosing : ""}`, onPointerDown: onClose, children: [_jsx("div", { className: styles.focusBackdrop }), _jsx("div", { className: styles.focusImage, style: {
                    left: expanded ? targetLeft : rect.left,
                    top: expanded ? targetTop : rect.top,
                    width: expanded ? finalWidth : rect.width,
                    height: expanded ? finalHeight : rect.height,
                }, children: _jsx("img", { src: focus.media.url, alt: focus.media.title ?? "", draggable: false, onLoad: (event) => {
                        const img = event.currentTarget;
                        if (img.decode) {
                            img.decode().catch(() => undefined).finally(() => setImageReady(true));
                        }
                        else {
                            setImageReady(true);
                        }
                    }, onError: () => setImageReady(true) }) }), _jsx(FocusTitle, { title: focus.media.title ?? "", visible: titleVisible && !closing })] }));
}
function SceneController({ media, onTextureProgress, onFocusChange, onFocusActive }) {
    const { camera, gl } = useThree();
    const isTouchDevice = useIsTouchDevice();
    const [, getKeys] = useKeyboardControls();
    const state = React.useRef(createInitialState(INITIAL_CAMERA_Z));
    const cameraGridRef = React.useRef({ cx: 0, cy: 0, cz: 0, camZ: camera.position.z });
    const [chunks, setChunks] = React.useState([]);
    const { progress } = useProgress();
    const maxProgress = React.useRef(0);
    React.useEffect(() => {
        const rounded = Math.round(progress);
        if (rounded > maxProgress.current) {
            maxProgress.current = rounded;
            onTextureProgress?.(rounded);
        }
    }, [progress, onTextureProgress]);
    React.useEffect(() => {
        const canvas = gl.domElement;
        const s = state.current;
        canvas.style.cursor = "grab";
        const setCursor = (cursor) => {
            canvas.style.cursor = cursor;
        };
        const onMouseDown = (e) => {
            // Just start dragging - keep drift frozen at current value
            s.isDragging = true;
            s.lastMouse = { x: e.clientX, y: e.clientY };
            setCursor("grabbing");
        };
        const onMouseUp = () => {
            s.isDragging = false;
            setCursor("grab");
        };
        const onMouseLeave = () => {
            s.mouse = { x: 0, y: 0 };
            s.isDragging = false;
            setCursor("grab");
        };
        const onMouseMove = (e) => {
            s.mouse = {
                x: (e.clientX / window.innerWidth) * 2 - 1,
                y: -(e.clientY / window.innerHeight) * 2 + 1,
            };
            if (s.isDragging) {
                s.targetVel.x -= (e.clientX - s.lastMouse.x) * 0.025;
                s.targetVel.y += (e.clientY - s.lastMouse.y) * 0.025;
                s.lastMouse = { x: e.clientX, y: e.clientY };
            }
        };
        const onWheel = (e) => {
            e.preventDefault();
            s.scrollAccum += e.deltaY * 0.006;
        };
        const onTouchStart = (e) => {
            s.lastTouches = Array.from(e.touches);
            s.lastTouchDist = getTouchDistance(s.lastTouches);
            setCursor("grabbing");
        };
        const onTouchMove = (e) => {
            e.preventDefault();
            const touches = Array.from(e.touches);
            if (touches.length === 1 && s.lastTouches.length >= 1) {
                const [touch] = touches;
                const [last] = s.lastTouches;
                if (touch && last) {
                    s.targetVel.x -= (touch.clientX - last.clientX) * 0.02;
                    s.targetVel.y += (touch.clientY - last.clientY) * 0.02;
                }
            }
            else if (touches.length === 2 && s.lastTouchDist > 0) {
                const dist = getTouchDistance(touches);
                s.scrollAccum += (s.lastTouchDist - dist) * 0.006;
                s.lastTouchDist = dist;
            }
            s.lastTouches = touches;
        };
        const onTouchEnd = (e) => {
            s.lastTouches = Array.from(e.touches);
            s.lastTouchDist = getTouchDistance(s.lastTouches);
            setCursor("grab");
        };
        canvas.addEventListener("mousedown", onMouseDown);
        window.addEventListener("mouseup", onMouseUp);
        window.addEventListener("mousemove", onMouseMove);
        canvas.addEventListener("mouseleave", onMouseLeave);
        canvas.addEventListener("wheel", onWheel, { passive: false });
        canvas.addEventListener("touchstart", onTouchStart, { passive: false });
        canvas.addEventListener("touchmove", onTouchMove, { passive: false });
        canvas.addEventListener("touchend", onTouchEnd, { passive: false });
        return () => {
            canvas.removeEventListener("mousedown", onMouseDown);
            window.removeEventListener("mouseup", onMouseUp);
            window.removeEventListener("mousemove", onMouseMove);
            canvas.removeEventListener("mouseleave", onMouseLeave);
            canvas.removeEventListener("wheel", onWheel);
            canvas.removeEventListener("touchstart", onTouchStart);
            canvas.removeEventListener("touchmove", onTouchMove);
            canvas.removeEventListener("touchend", onTouchEnd);
        };
    }, [gl]);
    useFrame(() => {
        const s = state.current;
        const now = performance.now();
        if (onFocusActive?.current) {
            s.targetVel.x = 0;
            s.targetVel.y = 0;
            s.targetVel.z = 0;
            s.velocity.x = 0;
            s.velocity.y = 0;
            s.velocity.z = 0;
            return;
        }
        const { forward, backward, left, right, up, down } = getKeys();
        if (forward)
            s.targetVel.z -= KEYBOARD_SPEED;
        if (backward)
            s.targetVel.z += KEYBOARD_SPEED;
        if (left)
            s.targetVel.x -= KEYBOARD_SPEED;
        if (right)
            s.targetVel.x += KEYBOARD_SPEED;
        if (down)
            s.targetVel.y -= KEYBOARD_SPEED;
        if (up)
            s.targetVel.y += KEYBOARD_SPEED;
        const isZooming = Math.abs(s.velocity.z) > 0.05;
        const zoomFactor = clamp(s.basePos.z / 50, 0.3, 2.0);
        const driftAmount = 8.0 * zoomFactor;
        const driftLerp = isZooming ? 0.2 : 0.12;
        if (s.isDragging) {
            // Freeze drift during drag - keep it at current value
        }
        else if (isTouchDevice) {
            s.drift.x = lerp(s.drift.x, 0, driftLerp);
            s.drift.y = lerp(s.drift.y, 0, driftLerp);
        }
        else {
            s.drift.x = lerp(s.drift.x, s.mouse.x * driftAmount, driftLerp);
            s.drift.y = lerp(s.drift.y, s.mouse.y * driftAmount, driftLerp);
        }
        s.targetVel.z += s.scrollAccum;
        s.scrollAccum *= 0.8;
        s.targetVel.x = clamp(s.targetVel.x, -MAX_VELOCITY, MAX_VELOCITY);
        s.targetVel.y = clamp(s.targetVel.y, -MAX_VELOCITY, MAX_VELOCITY);
        s.targetVel.z = clamp(s.targetVel.z, -MAX_VELOCITY, MAX_VELOCITY);
        s.velocity.x = lerp(s.velocity.x, s.targetVel.x, VELOCITY_LERP);
        s.velocity.y = lerp(s.velocity.y, s.targetVel.y, VELOCITY_LERP);
        s.velocity.z = lerp(s.velocity.z, s.targetVel.z, VELOCITY_LERP);
        s.basePos.x += s.velocity.x;
        s.basePos.y += s.velocity.y;
        s.basePos.z += s.velocity.z;
        camera.position.set(s.basePos.x + s.drift.x, s.basePos.y + s.drift.y, s.basePos.z);
        s.targetVel.x *= VELOCITY_DECAY;
        s.targetVel.y *= VELOCITY_DECAY;
        s.targetVel.z *= VELOCITY_DECAY;
        const cx = Math.floor(s.basePos.x / CHUNK_SIZE);
        const cy = Math.floor(s.basePos.y / CHUNK_SIZE);
        const cz = Math.floor(s.basePos.z / CHUNK_SIZE);
        cameraGridRef.current = { cx, cy, cz, camZ: s.basePos.z };
        const key = `${cx},${cy},${cz}`;
        if (key !== s.lastChunkKey) {
            s.pendingChunk = { cx, cy, cz };
            s.lastChunkKey = key;
        }
        const throttleMs = getChunkUpdateThrottleMs(isZooming, Math.abs(s.velocity.z));
        if (s.pendingChunk && shouldThrottleUpdate(s.lastChunkUpdate, throttleMs, now)) {
            const { cx: ucx, cy: ucy, cz: ucz } = s.pendingChunk;
            s.pendingChunk = null;
            s.lastChunkUpdate = now;
            setChunks(CHUNK_OFFSETS.map((o) => ({
                key: `${ucx + o.dx},${ucy + o.dy},${ucz + o.dz}`,
                cx: ucx + o.dx,
                cy: ucy + o.dy,
                cz: ucz + o.dz,
            })));
        }
    });
    React.useEffect(() => {
        const s = state.current;
        s.basePos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
        setChunks(CHUNK_OFFSETS.map((o) => ({
            key: `${o.dx},${o.dy},${o.dz}`,
            cx: o.dx,
            cy: o.dy,
            cz: o.dz,
        })));
    }, [camera]);
    const handleSelect = React.useCallback((position, scale, selectedMedia) => {
        if (onFocusActive?.current)
            return;
        const rect = projectPlaneRect(position, scale, camera, window.innerWidth, window.innerHeight);
        if (onFocusActive)
            onFocusActive.current = true;
        onFocusChange?.({ media: selectedMedia, rect });
    }, [camera, onFocusActive, onFocusChange]);
    return (_jsx(_Fragment, { children: chunks.map((chunk) => (_jsx(Chunk, { cx: chunk.cx, cy: chunk.cy, cz: chunk.cz, media: media, cameraGridRef: cameraGridRef, onSelect: handleSelect }, chunk.key))) }));
}
export function InfiniteCanvasScene({ media, onTextureProgress, showFps = false, showControls = false, cameraFov = 60, cameraNear = 1, cameraFar = 500, fogNear = 120, fogFar = 320, backgroundColor = "#ffffff", fogColor = "#ffffff", }) {
    const isTouchDevice = useIsTouchDevice();
    const dpr = Math.min(window.devicePixelRatio || 1, isTouchDevice ? 1.25 : 1.5);
    const [focus, setFocus] = React.useState(null);
    const [closing, setClosing] = React.useState(false);
    const sceneFocusActiveRef = React.useRef(false);
    const handleFocusChange = React.useCallback((next) => {
        setFocus(next);
        setClosing(false);
    }, []);
    const handleClose = React.useCallback(() => {
        if (!focus || closing)
            return;
        setClosing(true);
        window.setTimeout(() => {
            setFocus(null);
            setClosing(false);
            sceneFocusActiveRef.current = false;
        }, 950);
    }, [closing, focus]);
    if (!media.length) {
        return null;
    }
    return (_jsx(KeyboardControls, { map: KEYBOARD_MAP, children: _jsxs("div", { className: styles.container, children: [_jsxs(Canvas, { camera: { position: [0, 0, INITIAL_CAMERA_Z], fov: cameraFov, near: cameraNear, far: cameraFar }, dpr: dpr, flat: true, gl: { antialias: false, powerPreference: "high-performance" }, className: styles.canvas, children: [_jsx("color", { attach: "background", args: [backgroundColor] }), _jsx("fog", { attach: "fog", args: [fogColor, fogNear, fogFar] }), _jsx(SceneController, { media: media, onTextureProgress: onTextureProgress, onFocusChange: handleFocusChange, onFocusActive: sceneFocusActiveRef }), showFps && _jsx(Stats, { className: styles.stats })] }), focus && _jsx(FocusOverlay, { focus: focus, closing: closing, onClose: handleClose }), showControls && (_jsx("div", { className: styles.controlsPanel, children: isTouchDevice ? (_jsxs(_Fragment, { children: [_jsx("b", { children: "Drag" }), " Pan \u00B7 ", _jsx("b", { children: "Pinch" }), " Zoom"] })) : (_jsxs(_Fragment, { children: [_jsx("b", { children: "WASD" }), " Move \u00B7 ", _jsx("b", { children: "QE" }), " Up/Down \u00B7 ", _jsx("b", { children: "Scroll/Space" }), " Zoom"] })) }))] }) }));
}
