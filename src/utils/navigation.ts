import { type Href, type Router } from 'expo-router';

type RouteObject = {
  pathname: string;
  params?: Record<string, boolean | number | string | null | undefined>;
};

export type RouteTarget = Href | RouteObject | string;

export function asHref(href: RouteTarget): Href {
  return href as Href;
}

export function pushRoute(router: Router, href: RouteTarget): void {
  router.push(asHref(href));
}

export function replaceRoute(router: Router, href: RouteTarget): void {
  router.replace(asHref(href));
}
