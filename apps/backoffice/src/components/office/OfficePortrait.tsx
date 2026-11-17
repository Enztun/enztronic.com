import { useState } from "react";

import { OFFICE_PROFILES } from "./profiles";
import styles from "./office.module.css";

export function Portrait({ id, small = false }: { id: string; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  const profile = OFFICE_PROFILES.find((entry) => entry.id === id);
  // Images are served only through the authenticated private reference route.
  if (failed) return <span aria-hidden="true" className={small ? styles.portraitSmall : styles.portrait} style={{ display: "grid", placeItems: "center", color: "#c69a6a", fontSize: small ? 11 : 18 }}>{profile?.initials ?? "AI"}</span>;
  // The authenticated endpoint is intentionally not passed through the public Next image optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/api/office/reference/${id}.png`} alt="" width={small ? 37 : 68} height={small ? 37 : 68} loading="lazy" decoding="async" onError={() => setFailed(true)} className={small ? styles.portraitSmall : styles.portrait} />;
}
