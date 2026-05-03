import type { AppLanguageCode } from "./types";

type LandingVideoMosaicLabels = {
  preparingLayout: string;
  playVideo: string;
  pauseVideo: string;
  play: string;
  pause: string;
  volume: string;
  fullScreen: string;
  copyCreatorWallet: string;
  openInft: string;
  inft: string;
  viewInFeed: string;
  feed: string;
  wallet: string;
  seek: (title: string) => string;
};

export type LandingCopy = {
  metadata: {
    description: string;
  };
  navAria: string;
  homeAria: string;
  nav: {
    language: string;
    feed: string;
    storefronts: string;
    openConsole: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    lede: string;
    support: string;
    actionsAria: string;
    createProductVideo: string;
    storefrontDirectory: string;
    manageStorefront: string;
    viewVideoGallery: string;
  };
  introVideo: {
    aria: string;
    eyebrow: string;
    title: string;
  };
  showcase: {
    aria: string;
    header: string;
    badge: string;
    flow: string[];
    title: string;
    copy: string;
  };
  useCase: {
    eyebrow: string;
    title: string;
    points: string[];
  };
  productPillarsAria: string;
  productPillars: Array<{
    title: string;
    copy: string;
  }>;
  routes: {
    eyebrow: string;
    title: string;
    items: Array<{
      title: string;
      copy: string;
    }>;
  };
  blockchain: {
    eyebrow: string;
    title: string;
    note: string;
    points: string[];
  };
  how: {
    eyebrow: string;
    title: string;
    copy: string;
    steps: Array<{
      title: string;
      copy: string;
    }>;
  };
  video: {
    eyebrow: string;
    title: string;
    openFeed: string;
    emptyText: string;
    moreLabel: string;
    mosaicLabels: Partial<LandingVideoMosaicLabels>;
  };
};

export const landingCopy: Record<AppLanguageCode, LandingCopy> = {
  en: {
    metadata: {
      description: "A framework for Open Agents that turns referral links into generative marketing video stores, where every render can become an editable, auditable iNFT."
    },
    navAria: "Primary",
    homeAria: "SuperReferrals home",
    nav: {
      language: "Language",
      feed: "Feed",
      storefronts: "Storefronts",
      openConsole: "Open Console"
    },
    hero: {
      eyebrow: "Product Video Referrals",
      title: "Turn referral links into videos that convert",
      lede: "Give every recommendation a product story, visual style, and clear next step.",
      support: "SuperReferrals turns your product links or marketing ref links into unstoppable promo videos with scannable QR codes, drawing data and images straight from your product catalog.",
      actionsAria: "Open project routes",
      createProductVideo: "Create Product Video",
      storefrontDirectory: "Storefront directory",
      manageStorefront: "Manage Storefront",
      viewVideoGallery: "View Video Gallery"
    },
    introVideo: {
      aria: "SuperReferrals intro demo video",
      eyebrow: "Intro Demo",
      title: "See the referral video workflow in motion."
    },
    showcase: {
      aria: "SuperReferrals product flow",
      header: "Campaign builder",
      badge: "Catalog ready",
      flow: ["Product catalog", "Style controls", "Product video", "Referral page"],
      title: "Your ref links showcase your product and your vision.",
      copy: "Buyers see the product, creator context, campaign style, and purchase action in one place."
    },
    useCase: {
      eyebrow: "Use Case",
      title: "Referrals that show the product and lead to purchase.",
      points: [
        "Connect catalog data once for every campaign.",
        "Turn product images and details into audience-ready videos.",
        "Give buyers context before they purchase.",
        "Replace bare tracking URLs with useful media."
      ]
    },
    productPillarsAria: "Unique offerings",
    productPillars: [
      {
        title: "Catalog-ready",
        copy: "Use the simple or advanced video creator wizard to pull product images, prices, CTA URLs, and campaign metadata into each render."
      },
      {
        title: "Flexible video styles",
        copy: "Create explainers, launch edits, anime promos, futuristic ads, or brand-specific videos from product or listing metadata in both landscape and portrait formats."
      },
      {
        title: "Referral pages that convert",
        copy: "Turn every ref link into an editable marketing video page with product attributes, creator context, share actions, and a clear CTA."
      }
    ],
    routes: {
      eyebrow: "Marketing Video Creator",
      title: "Start where you need.",
      items: [
        { title: "Manage storefront", copy: "Set products, pricing, credits, and automation." },
        { title: "Create a product video", copy: "Choose a storefront, connect a wallet, and generate." },
        { title: "View video gallery", copy: "Browse completed videos and social actions." },
        { title: "Open latest video", copy: "Preview the latest render." }
      ]
    },
    blockchain: {
      eyebrow: "Powered by blockchain",
      title: "Programmable storefronts for crypto-native video creation.",
      note: "0G blockchain · KeeperHub · Auditable iNFT lineage",
      points: [
        "Launch storefronts with model menus, pricing, and checkout in the cryptocurrency you choose, so customers can pay you directly.",
        "Every customer receives a completed video render and a tradable iNFT record powered by 0G blockchain and KeeperHub.",
        "Choose the generation models, aspect ratios, and prices your storefront offers instead of exposing every backend option.",
        "Public discovery does not have to mean open rendering. Use address whitelists to decide who can create videos on your store.",
        "Every iNFT can be purchased as a deep clone. Buyers can replace scenes, retranslate, update outros and CTA links, or join their copy with other videos they own while your original remains yours.",
        "Every child purchase, edit, join, and downstream operation can be audited onchain, preserving a clear history for every derivative video."
      ]
    },
    how: {
      eyebrow: "How it works",
      title: "From storefront setup to editable onchain video ownership.",
      copy: "Storefront owners configure the business rules, creators generate the media, and purchasers receive editable iNFT clones with payments, storage, and audit handled by the network layer.",
      steps: [
        {
          title: "Storefront owner",
          copy: "Set up a samsar-js account at saamsar.one or buy in-app credits from Create storefront, then choose models, prices, accepted crypto, and render policy for your users."
        },
        {
          title: "Make it your own",
          copy: "Map your store URL to an ENS domain, choose your own branding and theme, and give customers only the storefront experience you decide to present."
        },
        {
          title: "Video creator",
          copy: "Creators choose a storefront, pay in the store currency, and generate product videos from catalog links, listing metadata, images, prompts, CTAs, and selected formats."
        },
        {
          title: "Purchaser",
          copy: "Purchasers receive a deep-cloned iNFT they can edit, retranslate, replace scenes, update outros and CTA URLs, or join with other videos they own while the audit trail remains intact."
        },
        {
          title: "Payments and refunds",
          copy: "KeeperHub coordinates decentralized payments and refunds users when a render fails or a transaction reverts. Internally, render operations consume samsar-js credits."
        },
        {
          title: "Storage and audit",
          copy: "Video renditions are saved in 0G blockchain storage, with edit and purchase trails guaranteed through 0G DA for durable provenance."
        },
        {
          title: "Page assistants",
          copy: "Every storefront, video, and referral page can include an LLM assistant powered by 0G compute for page-aware guidance and follow-up actions."
        }
      ]
    },
    video: {
      eyebrow: "Featured Renditions",
      title: "Latest storefront videos.",
      openFeed: "Open feed",
      emptyText: "No published storefront videos yet.",
      moreLabel: "More videos",
      mosaicLabels: {}
    }
  },
  zh: {
    metadata: {
      description: "面向 Open Agents 的框架，可将推荐链接转化为生成式营销视频店铺，并让每一次渲染都成为可编辑、可审计的 iNFT。"
    },
    navAria: "主导航",
    homeAria: "SuperReferrals 首页",
    nav: {
      language: "语言",
      feed: "动态",
      storefronts: "店铺",
      openConsole: "打开控制台"
    },
    hero: {
      eyebrow: "商品视频推荐",
      title: "把推荐链接变成更高转化的视频",
      lede: "让每一次推荐都拥有商品故事、视觉风格和清晰下一步。",
      support: "SuperReferrals 可将商品链接或营销推荐链接转化为带可扫码二维码的推广视频，并直接从商品目录提取数据与图片。",
      actionsAria: "打开项目页面",
      createProductVideo: "创建商品视频",
      storefrontDirectory: "店铺目录",
      manageStorefront: "管理店铺",
      viewVideoGallery: "查看视频图库"
    },
    introVideo: {
      aria: "SuperReferrals 入门演示视频",
      eyebrow: "入门演示",
      title: "观看推荐视频工作流如何运转。"
    },
    showcase: {
      aria: "SuperReferrals 商品流程",
      header: "活动构建器",
      badge: "已适配商品目录",
      flow: ["商品目录", "风格控制", "商品视频", "推荐页面"],
      title: "你的推荐链接可以展示商品，也展示你的创意。",
      copy: "买家可在同一页面看到商品、创作者背景、活动风格和购买操作。"
    },
    useCase: {
      eyebrow: "使用场景",
      title: "让推荐展示商品，并引导买家完成购买。",
      points: [
        "一次连接商品目录数据，服务每一场活动。",
        "将商品图片和详情转化为适合受众的视频。",
        "在购买前为买家提供清晰背景。",
        "用有价值的媒体内容替代单薄的追踪链接。"
      ]
    },
    productPillarsAria: "核心能力",
    productPillars: [
      {
        title: "商品目录就绪",
        copy: "使用简版或高级视频创建向导，将商品图片、价格、CTA URL 和活动元数据带入每一次渲染。"
      },
      {
        title: "灵活的视频风格",
        copy: "基于商品或列表元数据创建讲解视频、发布剪辑、动漫宣传片、未来感广告或品牌定制视频，并支持横版与竖版格式。"
      },
      {
        title: "可转化的推荐页面",
        copy: "把每个推荐链接变成可编辑的营销视频页面，包含商品属性、创作者背景、分享操作和清晰 CTA。"
      }
    ],
    routes: {
      eyebrow: "营销视频创建器",
      title: "从你需要的位置开始。",
      items: [
        { title: "管理店铺", copy: "设置商品、定价、额度和自动化。" },
        { title: "创建商品视频", copy: "选择店铺，连接钱包，然后生成视频。" },
        { title: "查看视频图库", copy: "浏览已完成视频和社交互动。" },
        { title: "打开最新视频", copy: "预览最新渲染结果。" }
      ]
    },
    blockchain: {
      eyebrow: "由区块链驱动",
      title: "面向加密原生视频创作的可编程店铺。",
      note: "0G 区块链 · KeeperHub · 可审计的 iNFT 谱系",
      points: [
        "用模型菜单、定价和自选加密货币结账发布店铺，让客户可以直接向你付款。",
        "每位客户都会获得已完成的视频渲染，以及由 0G 区块链和 KeeperHub 支持的可交易 iNFT 记录。",
        "自行选择店铺提供的生成模型、画面比例和价格，而不是暴露所有后端选项。",
        "公开发现不必等于开放渲染。使用地址白名单决定谁可以在你的店铺创建视频。",
        "每个 iNFT 都可作为深度克隆被购买。买家可以替换场景、重新翻译、更新结尾和 CTA 链接，或将自己的副本与其他视频合并，而你的原始版本仍归你所有。",
        "每次子级购买、编辑、合并和下游操作都可在链上审计，为每个衍生视频保留清晰历史。"
      ]
    },
    how: {
      eyebrow: "工作方式",
      title: "从店铺配置到可编辑的链上视频所有权。",
      copy: "店铺所有者配置业务规则，创作者生成媒体，购买者获得可编辑的 iNFT 克隆；支付、存储和审计由网络层处理。",
      steps: [
        {
          title: "店铺所有者",
          copy: "在 saamsar.one 设置 samsar-js 账户，或从“创建店铺”购买应用内额度，然后为用户选择模型、价格、接受的加密货币和渲染策略。"
        },
        {
          title: "打造自己的品牌",
          copy: "将店铺 URL 映射到 ENS 域名，选择自己的品牌和主题，并只向客户展示你决定呈现的店铺体验。"
        },
        {
          title: "视频创作者",
          copy: "创作者选择店铺，使用店铺货币付款，并基于商品目录链接、列表元数据、图片、提示词、CTA 和所选格式生成商品视频。"
        },
        {
          title: "购买者",
          copy: "购买者会收到可深度克隆的 iNFT，可进行编辑、重新翻译、替换场景、更新结尾和 CTA URL，或与自己拥有的其他视频合并，同时保留完整审计轨迹。"
        },
        {
          title: "支付与退款",
          copy: "KeeperHub 协调去中心化支付，并在渲染失败或交易回滚时为用户退款。内部渲染操作会消耗 samsar-js 额度。"
        },
        {
          title: "存储与审计",
          copy: "视频版本保存在 0G 区块链存储中，编辑和购买轨迹通过 0G DA 保证，形成持久来源记录。"
        },
        {
          title: "页面助手",
          copy: "每个店铺、视频和推荐页面都可包含由 0G compute 驱动的 LLM 助手，提供页面感知的指导和后续操作。"
        }
      ]
    },
    video: {
      eyebrow: "精选视频版本",
      title: "最新店铺视频。",
      openFeed: "打开动态",
      emptyText: "还没有已发布的店铺视频。",
      moreLabel: "更多视频",
      mosaicLabels: {
        preparingLayout: "正在准备视频布局...",
        playVideo: "播放视频",
        pauseVideo: "暂停视频",
        play: "播放",
        pause: "暂停",
        volume: "音量",
        fullScreen: "全屏",
        copyCreatorWallet: "复制创作者钱包",
        openInft: "打开 iNFT",
        inft: "iNFT",
        viewInFeed: "在动态中查看",
        feed: "动态",
        wallet: "钱包",
        seek: (title) => `跳转 ${title}`
      }
    }
  }
};
