"use client";

import type { ComponentProps, MouseEvent, ReactNode } from "react";
import { useTransition } from "react";
import { LoaderCircle } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type RouterHref = Parameters<ReturnType<typeof useRouter>["push"]>[0];

type PendingLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: RouterHref;
  pendingClassName?: string;
  pendingChildren?: ReactNode;
  spinnerClassName?: string;
  showSpinner?: boolean;
};

function isModifiedClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.button !== 0
  );
}

export function PendingLink({
  children,
  className,
  pendingClassName,
  pendingChildren,
  spinnerClassName,
  showSpinner = true,
  onClick,
  ...props
}: PendingLinkProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Link
      {...props}
      onClick={(event) => {
        if (pending) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
        if (
          !event.defaultPrevented &&
          !isModifiedClick(event) &&
          props.target !== "_blank"
        ) {
          event.preventDefault();
          startTransition(() => {
            if (props.replace) {
              router.replace(props.href, { locale: props.locale, scroll: props.scroll });
            } else {
              router.push(props.href, { locale: props.locale, scroll: props.scroll });
            }
          });
        }
      }}
      aria-busy={pending || undefined}
      aria-disabled={pending || undefined}
      className={cn(className, pending && pendingClassName)}
    >
      {pending && pendingChildren ? (
        pendingChildren
      ) : showSpinner && pending ? (
        <LoaderCircle
          className={cn("h-3.5 w-3.5 animate-spin", spinnerClassName)}
          aria-hidden="true"
        />
      ) : null}
      {(!pending || !pendingChildren) && children}
    </Link>
  );
}
