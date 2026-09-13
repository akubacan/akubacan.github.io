import { jsx as _jsx } from "react/jsx-runtime";
import styles from "./style.module.js";
export function Frame() {
    return (_jsx("header", { className: `frame ${styles.frame}`, children: _jsx("h1", { className: styles.frame__title, children: "akubacan" }) }));
}
