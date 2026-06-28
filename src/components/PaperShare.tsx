"use client";

import { ShareMenu } from "./ShareMenu";

/**
 * Thin client wrapper so the server detail page can drop in a share menu.
 * `onShareImage` opens the paper's OG card (the social preview / flex image) in a
 * new tab so it can be saved and posted to 微信/小红书.
 */
export function PaperShare({ link, text, cardUrl }: { link: string; text: string; cardUrl: string }) {
  return (
    <ShareMenu
      link={link}
      text={text}
      onShareImage={() => window.open(cardUrl, "_blank", "noopener,noreferrer")}
    />
  );
}
