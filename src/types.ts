export interface ActorInput {
    mode?: "profile" | "tag" | "search" | "thread" | "feed";
    accounts?: string[];
    bulkAccounts?: string;
    keywordsOrTags?: string[];
    bulkKeywordsOrTags?: string;
    threadUrls?: { url: string }[];
    feedUrls?: { url: string }[];
    cookies?: any[];
    maxPostsPerAccount?: number;
    maxItems?: number;
    searchSort?: "top" | "latest" | "profiles";
    postLanguageFilter?: string;
    languageFilter?: string;
    startDate?: string;
    endDate?: string;
    relativeDate?: string;
    includeRawText?: boolean;
    telegramToken?: string;
    telegramChatId?: string;
}

export interface ThreadMetrics {
    likes: string | null;
    replies: string | null;
    reposts: string | null;
    shares: string | null;
    views: string | null;
    quotes: string | null;
    raw: (string | null)[];
}

export interface ThreadPost {
    author: string;
    posted_at: string;
    posted_at_iso: string | null;
    text: string;
    post_url?: string;
    metrics: ThreadMetrics;
}

export interface ThreadProfile {
    username: string | null;
    display_name: string | null;
    bio: string | null;
    external_url: string | null;
    followers: string | null;
}

export interface ProfileSearchResult {
    username: string;
    url: string;
    text: string | null;
}

export interface ScrapedResult {
    url: string;
    mode?: string;
    target?: string;
    scraped_at: string;
    title: string;
    profile: ThreadProfile;
    posts: ThreadPost[];
    replies?: ThreadPost[];
    profiles?: ProfileSearchResult[];
    raw_visible_text?: string;
}
