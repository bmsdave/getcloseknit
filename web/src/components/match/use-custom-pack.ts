"use client";

import { useEffect, useState } from "react";

import { evaluateCustomCriterion, type CustomCriterion, type CustomCriterionPack } from "@/lib/custom-criteria";

/** The criterion for every London area (POST, cached per definition); null while loading or without one. */
export function useCustomPack(criterion: CustomCriterion | null): CustomCriterionPack | null {
  const [pack, setPack] = useState<CustomCriterionPack | null>(null);
  const key = criterion ? JSON.stringify(criterion) : null;
  useEffect(() => {
    setPack(null);
    if (!key) return;
    let live = true;
    void evaluateCustomCriterion(JSON.parse(key) as CustomCriterion).then((value) => { if (live) setPack(value); });
    return () => { live = false; };
  }, [key]);
  return pack;
}
