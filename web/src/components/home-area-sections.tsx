"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ComponentProps } from "react";

import type { AreaSectionsForHome as Sections } from "./area-full-page";

const Loading = () => <p className="area-section__status" role="status" data-testid="area-evidence-loading">Loading this area&apos;s evidence…</p>;

/** The area page's code loads with the sections, not with the home's own blocks. */
const AreaSectionsForHome = dynamic(() => import("./area-full-page").then((loaded) => loaded.AreaSectionsForHome), {
  ssr: false, loading: Loading,
});

/**
 * A street-level home's area sections (its page is noindex, so nothing is lost by not rendering them on the
 * server): their code and their reads start only as the reader nears them, so a visit that stops above them
 * reads none. A home with a UPRN renders AreaSectionsForHome on the server, seeded, instead.
 */
export function HomeAreaSections(props: ComponentProps<typeof Sections>) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || near) return;
    if (typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setNear(true);
    }, { rootMargin: "600px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);
  return (
    <div ref={ref}>
      {near ? <AreaSectionsForHome {...props} /> : <Loading />}
    </div>
  );
}
