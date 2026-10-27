"use client";

import { useLayoutEffect, useState } from "react";

import type { PreferenceProfile } from "@/lib/contracts";
import { DEFAULT_PROFILE } from "@/lib/fixtures";
import { isUnsetProfile, loadLocalProfile, PROFILE_SAVED_EVENT, saveTailoredProfile } from "@/lib/profile-state";

/**
 * The household's saved profile on this device, read before the first paint (a layout effect, so tiles
 * never show the default slots and then swap) and again whenever the Tailor card (here or in another
 * view) saves. Nothing leaves the device (personalisation-spec.md §5).
 */
export function useTailor(): { profile: PreferenceProfile; save: (profile: PreferenceProfile) => void } {
  const [profile, setProfile] = useState<PreferenceProfile>(DEFAULT_PROFILE);
  useLayoutEffect(() => {
    const read = () => setProfile(loadLocalProfile(DEFAULT_PROFILE));
    read();
    window.addEventListener(PROFILE_SAVED_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(PROFILE_SAVED_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return { profile, save: (next) => saveTailoredProfile(next, isUnsetProfile(profile)) };
}
