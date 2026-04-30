import type { AppLanguageCode } from "./types";

type AssistantCopy = {
  launcherLabel: string;
  openAssistant: string;
  closeAssistant: string;
  panelLabel: string;
  clearConversation: string;
  clearConversationConfirm: string;
  expandAssistant: string;
  condenseAssistant: string;
  collapseAssistant: string;
  dismissNotice: string;
  you: string;
  assistant: string;
  copyMessage: string;
  placeholder: string;
  send: string;
  typing: string;
  errors: {
    load: string;
    request: string;
    clear: string;
    copy: string;
    generic: string;
  };
  pageLabels: Record<string, string>;
};

export const assistantCopy: Record<AppLanguageCode, AssistantCopy> = {
  en: {
    launcherLabel: "Assistant",
    openAssistant: "Open assistant",
    closeAssistant: "Close assistant",
    panelLabel: "Page assistant",
    clearConversation: "Clear conversation",
    clearConversationConfirm: "Clear this page assistant conversation?",
    expandAssistant: "Expand assistant",
    condenseAssistant: "Condense assistant",
    collapseAssistant: "Collapse assistant",
    dismissNotice: "Dismiss assistant notice",
    you: "You",
    assistant: "Assistant",
    copyMessage: "Copy message",
    placeholder: "Ask about this page...",
    send: "Send",
    typing: "Assistant is responding",
    errors: {
      load: "Assistant failed to load.",
      request: "Assistant request failed.",
      clear: "Unable to clear assistant.",
      copy: "Unable to copy message.",
      generic: "Request failed"
    },
    pageLabels: {
      "/": "Landing",
      "/dashboard": "Storefront Creator",
      "/storefronts": "Storefront Directory",
      "/feed": "Video Feed",
      "/payment_success": "Payment Success",
      "/payment_cancel": "Payment Cancelled",
      "Landing": "Landing",
      "Storefront Creator": "Storefront Creator",
      "Storefront Directory": "Storefront Directory",
      "Video Feed": "Video Feed",
      "Payment Success": "Payment Success",
      "Payment Cancelled": "Payment Cancelled",
      "Referral Route": "Referral Route",
      "Storefront": "Storefront",
      "INFT": "INFT",
      "SuperReferrals": "SuperReferrals"
    }
  },
  zh: {
    launcherLabel: "助手",
    openAssistant: "打开助手",
    closeAssistant: "关闭助手",
    panelLabel: "页面助手",
    clearConversation: "清空对话",
    clearConversationConfirm: "清空此页面助手对话？",
    expandAssistant: "展开助手",
    condenseAssistant: "收起助手",
    collapseAssistant: "折叠助手",
    dismissNotice: "关闭助手提示",
    you: "你",
    assistant: "助手",
    copyMessage: "复制消息",
    placeholder: "询问此页面...",
    send: "发送",
    typing: "助手正在回复",
    errors: {
      load: "助手加载失败。",
      request: "助手请求失败。",
      clear: "无法清空助手。",
      copy: "无法复制消息。",
      generic: "请求失败"
    },
    pageLabels: {
      "/": "首页",
      "/dashboard": "店铺创建器",
      "/storefronts": "店铺目录",
      "/feed": "视频动态",
      "/payment_success": "支付成功",
      "/payment_cancel": "支付已取消",
      "Landing": "首页",
      "Storefront Creator": "店铺创建器",
      "Storefront Directory": "店铺目录",
      "Video Feed": "视频动态",
      "Payment Success": "支付成功",
      "Payment Cancelled": "支付已取消",
      "Referral Route": "推荐页面",
      "Storefront": "店铺",
      "INFT": "iNFT",
      "SuperReferrals": "SuperReferrals"
    }
  }
};

export function localizedAssistantPageLabel(
  language: AppLanguageCode,
  pathname: string,
  pageTitle?: string
) {
  const labels = assistantCopy[language].pageLabels;
  if (pageTitle && labels[pageTitle]) {
    return labels[pageTitle];
  }
  if (pageTitle && !isGeneratedPathLabel(pageTitle, pathname)) {
    return pageTitle;
  }
  if (labels[pathname]) {
    return labels[pathname];
  }
  return pageLabelFromPath(pathname, language);
}

function pageLabelFromPath(pathname: string, language: AppLanguageCode) {
  if (pathname === "/") {
    return assistantCopy[language].pageLabels["/"];
  }
  const segments = pathname.split("/").filter(Boolean);
  if (!segments.length) {
    return assistantCopy[language].pageLabels.SuperReferrals;
  }
  return segments
    .slice(0, 2)
    .map((segment) => segment.replace(/[-_]/g, " "))
    .map((segment) => {
      if (language === "zh" && segment === "zh") {
        return "中文";
      }
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join(" / ");
}

function isGeneratedPathLabel(pageTitle: string, pathname: string) {
  return pageTitle === pageLabelFromPath(pathname, "en");
}
