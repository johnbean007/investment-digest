You are given a list of stock tickers, each with the company name as it was mentioned
on a YouTube investing channel, and where available an official business summary.

For each entry, write a plain-English description of what the company actually does,
in 12 words or fewer. Describe the business, not the stock.

Rules:

- Lead with the product or service. "Designs GPUs for AI data centres and gaming"
  is good. "A leading technology company" is useless filler.
- No marketing adjectives: no "leading", "innovative", "world-class", "premier".
- Do not mention the share price, market capitalisation, analyst ratings, or whether
  it is a good investment.
- Where an official summary is supplied, base the description on it. Strip the
  boilerplate geography ("in the United States, Canada, and internationally") and
  the corporate suffix.
- Where no summary is supplied, use your own knowledge of the company.
- Identify the company from the company name first, and the ticker second. Many of
  these tickers are wrong: they were transcribed from speech, so the ticker may be
  misspelled, may be the company's name rather than its symbol, or may belong to a
  private company with no symbol at all. A wrong ticker with a clear company name
  is still describable. Describe the company the name refers to.
- Return null ONLY when you genuinely cannot tell which company is meant. Never
  guess: an invented description is a defect. Do not return null merely because the
  ticker looks malformed, or because the company is private and unlisted.
- The company name was itself transcribed from speech by an earlier step, and it
  sometimes carries that step's own doubt. Return null when the name:
    - hedges, e.g. "unclear", "likely", "believed to be", "or similar", "or
      context unclear";
    - offers two different candidate companies, e.g. "Tonergy Global / T One Energy";
    - names a sector or theme rather than a company, e.g. "Fintech Sector (General)".
  Do not try to resolve the hedge yourself. If an earlier step could not identify it
  from the full transcript, you cannot identify it from a fragment.
- Never reuse one entry's description for another entry. If two tickers look
  related but only one is clearly identified, describe that one and return null for
  the other. Copying a neighbour's description is the specific failure to avoid.

Return ONLY a JSON object mapping each ticker to its description string or null.
No prose, no code fences, no explanation.

A private, pre-IPO or unlisted company is still a company: describe what it does.
Only the genuinely unidentifiable gets a null.

Example of the exact shape expected. Note that ANTHROPIC is not a real exchange
ticker and the company is private, but it is perfectly identifiable, so it is
described; ZMB identifies nothing, so it is null:

{"NVDA": "Designs GPUs and AI data centre hardware",
 "ANTHROPIC": "AI safety research company behind the Claude language models",
 "ZMB": null}

Entries:

{entries}
