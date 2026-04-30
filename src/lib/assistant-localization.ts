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
  empty: {
    loading: string;
    title: string;
    intro: string;
    contextLabel: string;
    modelLabel: string;
    environmentLabel: string;
    suggestionsLabel: string;
    modelFallback: string;
    environmentFallback: string;
    suggestions: Record<string, string[]>;
  };
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
    empty: {
      loading: "Loading page context...",
      title: "How can I help with this page?",
      intro: "Ask about the current workflow, available actions, or what to do next. The assistant uses this page context and your chat history.",
      contextLabel: "Context",
      modelLabel: "Model",
      environmentLabel: "Environment",
      suggestionsLabel: "Try asking",
      modelFallback: "0G Compute assistant",
      environmentFallback: "Current deployment",
      suggestions: {
        "/": [
          "What can I create from here?",
          "Which route should I open first?",
          "How do referrals become videos?"
        ],
        "/dashboard": [
          "How do I create a storefront?",
          "What should I configure before publishing?",
          "Where do I manage credits and pricing?"
        ],
        "/storefronts": [
          "How do I choose a storefront?",
          "What does each storefront card show?",
          "How do I open a product video creator?"
        ],
        "/r": [
          "What do I need before generating a video?",
          "How does payment work on this storefront?",
          "Which render settings should I check?"
        ],
        "/inft": [
          "What can I do with this iNFT?",
          "Which paid actions are available?",
          "How do edits affect ownership history?"
        ],
        "/payment_success": [
          "What happens after payment succeeds?",
          "Where should I go next?",
          "How do I check my credits?"
        ],
        "/payment_cancel": [
          "How do I return to setup?",
          "Can I retry checkout?",
          "What should I check before paying again?"
        ],
        default: [
          "What can I do on this page?",
          "What should I try next?",
          "Explain the visible controls."
        ]
      }
    },
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
    empty: {
      loading: "正在加载页面上下文...",
      title: "需要我帮你了解此页面吗？",
      intro: "你可以询问当前流程、可用操作或下一步该做什么。助手会使用此页面上下文和你的对话历史。",
      contextLabel: "上下文",
      modelLabel: "模型",
      environmentLabel: "环境",
      suggestionsLabel: "可以这样问",
      modelFallback: "0G Compute 助手",
      environmentFallback: "当前部署",
      suggestions: {
        "/": [
          "我可以从这里创建什么？",
          "应该先打开哪个页面？",
          "推荐链接如何变成视频？"
        ],
        "/dashboard": [
          "如何创建店铺？",
          "发布前需要配置什么？",
          "在哪里管理额度和定价？"
        ],
        "/storefronts": [
          "如何选择店铺？",
          "每张店铺卡片显示什么？",
          "如何打开商品视频创建器？"
        ],
        "/r": [
          "生成视频前需要准备什么？",
          "这个店铺的付款流程是什么？",
          "我应该检查哪些渲染设置？"
        ],
        "/inft": [
          "我可以用这个 iNFT 做什么？",
          "有哪些付费操作？",
          "编辑会如何影响所有权历史？"
        ],
        "/payment_success": [
          "支付成功后会发生什么？",
          "下一步应该去哪里？",
          "如何检查我的额度？"
        ],
        "/payment_cancel": [
          "如何返回设置？",
          "可以重新尝试结账吗？",
          "再次付款前应该检查什么？"
        ],
        default: [
          "这个页面可以做什么？",
          "下一步应该尝试什么？",
          "说明一下可见控件。"
        ]
      }
    },
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
  const normalizedPathname = normalizeAssistantPagePathForLocale(pathname);
  const labels = assistantCopy[language].pageLabels;
  if (pageTitle && labels[pageTitle]) {
    return labels[pageTitle];
  }
  if (pageTitle && !isGeneratedPathLabel(pageTitle, normalizedPathname)) {
    return pageTitle;
  }
  if (labels[normalizedPathname]) {
    return labels[normalizedPathname];
  }
  return pageLabelFromPath(normalizedPathname, language);
}

export function localizedAssistantEmptySuggestions(language: AppLanguageCode, pathname: string) {
  const suggestions = assistantCopy[language].empty.suggestions;
  return suggestions[assistantSuggestionKey(pathname)] || suggestions.default;
}

export function normalizeAssistantPagePathForLocale(pathname: string) {
  const normalized = `/${pathname.split(/[?#]/)[0].split("/").filter(Boolean).join("/")}`;
  if (normalized === "/zh") {
    return "/";
  }
  if (normalized.startsWith("/zh/")) {
    return normalized.slice(3) || "/";
  }
  return normalized === "/" ? "/" : normalized.replace(/\/$/, "");
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

function assistantSuggestionKey(pathname: string) {
  const normalized = normalizeAssistantPagePathForLocale(pathname);
  if (normalized === "/") {
    return "/";
  }
  const [firstSegment] = normalized.split("/").filter(Boolean);
  if (!firstSegment) {
    return "default";
  }
  if (firstSegment === "storefronts") {
    return normalized === "/storefronts" ? "/storefronts" : "/r";
  }
  if (firstSegment === "r") {
    return "/r";
  }
  if (firstSegment === "inft") {
    return "/inft";
  }
  const directKey = `/${firstSegment}`;
  return assistantCopy.en.empty.suggestions[directKey] ? directKey : "default";
}
