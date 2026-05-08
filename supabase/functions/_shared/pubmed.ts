type ESearchResult = {
  esearchresult?: {
    idlist?: string[];
  };
};

type ESummaryResult = {
  result?: {
    uids?: string[];
    [key: string]: unknown;
  };
};

export type PubmedCitation = {
  pmid: string;
  title: string;
  pubdate?: string;
  source?: string;
  url: string;
};

function pubmedUrl(pmid: string) {
  return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
}

export async function searchPubMed(query: string, max = 3): Promise<PubmedCitation[]> {
  const esearch = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
  esearch.searchParams.set("db", "pubmed");
  esearch.searchParams.set("retmode", "json");
  esearch.searchParams.set("retmax", String(max));
  esearch.searchParams.set("sort", "relevance");
  esearch.searchParams.set("term", query);

  const searchRes = await fetch(esearch);
  if (!searchRes.ok) return [];

  const searchJson = (await searchRes.json()) as ESearchResult;
  const ids = searchJson.esearchresult?.idlist ?? [];
  if (!ids.length) return [];

  const esummary = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
  esummary.searchParams.set("db", "pubmed");
  esummary.searchParams.set("retmode", "json");
  esummary.searchParams.set("id", ids.join(","));

  const summaryRes = await fetch(esummary);
  if (!summaryRes.ok) return ids.map((pmid) => ({
    pmid,
    title: `PubMed ${pmid}`,
    url: pubmedUrl(pmid),
  }));

  const summaryJson = (await summaryRes.json()) as ESummaryResult;
  const result = (summaryJson.result ?? {}) as Record<string, any>;

  return ids.map((pmid) => {
    const item = result[pmid] ?? {};
    return {
      pmid,
      title: item.title ?? `PubMed ${pmid}`,
      pubdate: item.pubdate,
      source: item.source,
      url: pubmedUrl(pmid),
    };
  });
}

