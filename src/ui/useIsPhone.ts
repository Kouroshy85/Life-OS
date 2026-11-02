import { useEffect, useState } from "react";

const QUERY = "(max-width: 820px)";

/** Whether the screen is phone-sized. Matches the breakpoint in phone.css. */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const onChange = () => setPhone(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return phone;
}
