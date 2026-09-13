import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import manifest from "../artworks/manifest.js";
import { Frame } from "../frame/index.js";
import { InfiniteCanvas } from "../infinite-canvas/index.js";
import { PageLoader } from "../loader/index.js";
export function App() {
    const [media] = React.useState(manifest);
    const [textureProgress, setTextureProgress] = React.useState(0);
    if (!media.length) {
        return _jsx(PageLoader, { progress: 0 });
    }
    return (_jsxs(_Fragment, { children: [_jsx(Frame, {}), _jsx(PageLoader, { progress: textureProgress }), _jsx(InfiniteCanvas, { media: media, onTextureProgress: setTextureProgress })] }));
}
