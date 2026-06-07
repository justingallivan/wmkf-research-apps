/**
 * @jest-environment node
 */

const { PubMedService } = require('../../lib/services/pubmed-service');

describe('PubMedService.parseXML publication date precedence', () => {
  test('derives year from ArticleDate/PubDate before DateCompleted/DateRevised', async () => {
    const xml = `<?xml version="1.0"?>
      <PubmedArticleSet>
        <PubmedArticle>
          <MedlineCitation>
            <PMID>111</PMID>
            <DateCompleted><Year>2025</Year><Month>12</Month><Day>31</Day></DateCompleted>
            <DateRevised><Year>2026</Year><Month>01</Month><Day>02</Day></DateRevised>
            <Article>
              <ArticleTitle>Article date wins</ArticleTitle>
              <Journal>
                <Title>Journal A</Title>
                <JournalIssue><PubDate><Year>2020</Year><Month>Jan</Month><Day>5</Day></PubDate></JournalIssue>
              </Journal>
              <ArticleDate DateType="Electronic"><Year>2021</Year><Month>03</Month><Day>04</Day></ArticleDate>
              <AuthorList><Author><LastName>Researcher</LastName><ForeName>Alice</ForeName></Author></AuthorList>
            </Article>
          </MedlineCitation>
        </PubmedArticle>
        <PubmedArticle>
          <MedlineCitation>
            <PMID>222</PMID>
            <DateCompleted><Year>2025</Year><Month>12</Month><Day>31</Day></DateCompleted>
            <DateRevised><Year>2026</Year><Month>01</Month><Day>02</Day></DateRevised>
            <Article>
              <ArticleTitle>PubDate wins without ArticleDate</ArticleTitle>
              <Journal>
                <Title>Journal B</Title>
                <JournalIssue><PubDate><Year>2019</Year><Month>Feb</Month><Day>6</Day></PubDate></JournalIssue>
              </Journal>
              <AuthorList><Author><LastName>Researcher</LastName><ForeName>Bob</ForeName></Author></AuthorList>
            </Article>
          </MedlineCitation>
        </PubmedArticle>
      </PubmedArticleSet>`;

    const articles = await PubMedService.parseXML(xml);

    expect(articles.map((a) => ({ pmid: a.pmid, year: a.year }))).toEqual([
      { pmid: '111', year: 2021 },
      { pmid: '222', year: 2019 },
    ]);
    expect(articles[0].publicationDate.toISOString()).toMatch(/^2021-03-04/);
    expect(articles[1].publicationDate.toISOString()).toMatch(/^2019-02-06/);
  });
});
