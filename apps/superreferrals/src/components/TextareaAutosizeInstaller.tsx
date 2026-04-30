"use client";

import { useEffect } from "react";

function resizeTextarea(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function resizeAllTextareas(root: ParentNode = document) {
  root.querySelectorAll("textarea").forEach((textarea) => {
    resizeTextarea(textarea as HTMLTextAreaElement);
  });
}

export default function TextareaAutosizeInstaller() {
  useEffect(() => {
    const onInput = (event: Event) => {
      if (event.target instanceof HTMLTextAreaElement) {
        resizeTextarea(event.target);
      }
      requestAnimationFrame(() => resizeAllTextareas());
    };
    const onResize = () => resizeAllTextareas();
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLTextAreaElement) {
            resizeTextarea(node);
          } else if (node instanceof Element) {
            resizeAllTextareas(node);
          }
        });
      });
    });

    document.addEventListener("input", onInput, true);
    window.addEventListener("resize", onResize);
    observer.observe(document.body, { childList: true, subtree: true });
    requestAnimationFrame(() => resizeAllTextareas());

    return () => {
      document.removeEventListener("input", onInput, true);
      window.removeEventListener("resize", onResize);
      observer.disconnect();
    };
  }, []);

  return null;
}
