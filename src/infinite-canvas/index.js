import { jsx as _jsx } from "react/jsx-runtime";
import * as React from "react";
const LazyInfiniteCanvasScene = React.lazy(() => import("./scene.js").then((mod) => ({ default: mod.InfiniteCanvasScene })));
export function InfiniteCanvas(props) {
    return (_jsx(React.Suspense, { fallback: null, children: _jsx(LazyInfiniteCanvasScene, { ...props }) }));
}
