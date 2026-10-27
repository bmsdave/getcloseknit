"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useId, useState, type ReactNode } from "react";

import { currentLink, isNavGroup, SITE_NAV, SITE_NAV_FOOTER, SITE_NAV_GROUPS, type SiteNavGroup, type SiteNavLink } from "@/lib/site-nav";

import { useUiTheme } from "./appearance-menu";
import { KnitIcon } from "./knit/knit-icon";
import { useDisclosure } from "./top-bar-menu";

/** Board words for the interface themes (lib/ui-themes.ts ids). */
const THEMES = [["auto", "Auto"], ["day", "Day"], ["night", "Night"]] as const;

/**
 * Menu v5 (owner board): five plain links at fold weight (Find a place, My match, Rankings,
 * Schools, AI agents), then Tools and Learn as folds (one open at a time).
 * Menu A: the folds,
 * then one settings block: on the map its Map and Colours rows, then the
 * theme, and on the map only a small Privacy · Terms · Feedback line (pages
 * off the map carry those in their footer). The same list (lib/site-nav.ts)
 * on the map and in every page's header.
 */
export function SiteMenu({ onMap = false, mapSettings, theme, onCredits }: {
  onMap?: boolean;
  /** On the map: opens the map credits (the short layout's ⓘ). */
  onCredits?: () => void;
  /** On the map: the Map (2D/3D) and Colours rows (map-settings.tsx). */
  mapSettings?: ReactNode;
  /** The map's own theme state, so its Colours panel stays in step. */
  theme?: { themeId: string; chooseTheme: (id: string) => void };
}) {
  // MenuA-v4: the accordion opens on the group holding this page, else stays shut.
  const pathname = usePathname();
  const here = currentLink(pathname);
  const [open, setOpen] = useState<SiteNavGroup["id"] | null>(
    SITE_NAV_GROUPS.find((group) => here && group.links.includes(here))?.id ?? null);
  const own = useUiTheme();
  const { themeId, chooseTheme } = theme ?? own;
  const id = useId();
  return (
    <nav className="site-menu" aria-label="Site menu">
      {SITE_NAV.map((group) => {
        if (!isNavGroup(group)) return <MenuLink key={group.label} link={group} current={group === here} top />;
        const expanded = open === group.id;
        return (
          <div key={group.id} className="site-menu__group">
            <button type="button" className="top-menu-row site-menu__fold" data-fold aria-expanded={expanded} aria-controls={`${id}-${group.id}`}
              onClick={() => setOpen(expanded ? null : group.id)}>
              {group.label}
              <KnitIcon name="chevron-down" colour="var(--icon-yarn, currentColor)" className="top-menu-caret" style={{ width: 14, height: 14 }} />
            </button>
            {expanded && (
              <div className="site-menu__links" id={`${id}-${group.id}`}>
                {group.links.map((link) => <MenuLink key={link.label} link={link} current={link === here} />)}
              </div>
            )}
          </div>
        );
      })}
      <div className="site-menu__settings" role="group" aria-label="Settings">
        {onMap && mapSettings && <div className="site-menu__map" data-testid="map-settings">{mapSettings}</div>}
        <div className="menu-row">
          <span className="menu-row__label" id={`${id}-theme`}>Theme</span>
          <div className="menu-seg site-menu__theme" role="group" aria-labelledby={`${id}-theme`}>
            {THEMES.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={themeId === value} onClick={() => chooseTheme(value)}>{label}</button>
            ))}
          </div>
        </div>
        {onMap && (
          <p className="site-menu__legal">
            {SITE_NAV_FOOTER.map((link, index) => (
              <Fragment key={link.href}>
                {index > 0 && <span aria-hidden="true">·</span>}
                <Link href={link.href} data-testid={link.testId}>{link.label}</Link>
              </Fragment>
            ))}
            {/* A phone on its side has no ⓘ on the map: its credits are here (layout.css shows it then). */}
            {onCredits && (
              <span className="site-menu__credits">
                <span aria-hidden="true">·</span>
                <button type="button" className="link-button" data-testid="menu-map-credits" onClick={onCredits}>Map credits</button>
              </span>
            )}
          </p>
        )}
      </div>
    </nav>
  );
}

function MenuLink({ link, current, top = false }: { link: SiteNavLink; current: boolean; top?: boolean }) {
  // A top-level link sits at fold weight (Menu v5); a fold's links are indented under it.
  const className = top ? "site-menu__link site-menu__top" : "site-menu__link";
  // The map reads its query on boot (My match): a full load.
  if (link.href.startsWith("/?")) return <a href={link.href} className={className}>{link.label}</a>;
  return (
    <Link href={link.href} className={className} data-testid={link.testId} aria-current={current ? "page" : undefined}>
      {link.label}
    </Link>
  );
}

/** The ≡ button and its panel in a page's header (site-header.tsx); the map's is TopBarMenu. */
export function SiteMenuButton() {
  const menu = useDisclosure();
  const pathname = usePathname();
  const { setOpen } = menu;
  // A page reached from the menu opens with it closed.
  useEffect(() => setOpen(false), [pathname, setOpen]);
  return (
    <div className="site-header__menu" ref={menu.wrap}>
      <button {...menu.buttonProps} className="site-header__menu-toggle" data-testid="top-menu-toggle" aria-label="Menu">
        <KnitIcon name="menu" colour="var(--icon-yarn, currentColor)" className="top-menu-knit" style={{ width: 20, height: 20 }} />
      </button>
      {menu.open && (
        <div className="top-menu-panel site-menu-panel" id={menu.panelId} data-testid="top-menu">
          <SiteMenu />
        </div>
      )}
    </div>
  );
}
