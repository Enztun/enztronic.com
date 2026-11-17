"use client";

import { Info, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import styles from "./office.module.css";

/** Short, optional information: hover, keyboard focus and touch all open it. */
export function OfficeInfo({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 600px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target) && !popup.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const information = open ? <div ref={popup} id={id} className={styles.infoContent} role="tooltip">{children}</div> : null;
  return <div ref={root} className={styles.infoWrap}
    onMouseEnter={() => setOpen(true)}
    onMouseLeave={() => { if (!root.current?.contains(document.activeElement)) setOpen(false); }}
    onFocusCapture={() => setOpen(true)}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={(event) => { if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); } }}>
    <button type="button" className={styles.infoButton} aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined} onClick={() => setOpen(true)}><Info size={15} aria-hidden="true" /></button>
    {/* A body portal avoids the app's animated/translated page container clipping a mobile sheet. */}
    {mobile && information ? createPortal(information, document.body) : information}
  </div>;
}

/** Dismissal changes presentation only; it never clears a save/error guard or a record. */
export function OfficeNoticeBanner({ children, tone, label = "Dismiss notification" }: { children: ReactNode; tone?: "success" | "warning" | "error"; label?: string }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return <div className={`${styles.notice} ${styles.dismissibleNotice} ${tone === "success" ? styles.noticeSuccess : tone === "warning" ? styles.noticeWarning : tone === "error" ? styles.noticeError : ""}`} role={tone === "error" ? "alert" : "status"}>
    <div className={styles.noticeBody}>{children}</div>
    <button type="button" className={styles.noticeClose} aria-label={label} onClick={() => setDismissed(true)}><X size={14} aria-hidden="true" /></button>
  </div>;
}
