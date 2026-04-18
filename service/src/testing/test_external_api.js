export function buildTestExternalApiClient() {
  return {
    async search() {
      return [{
        chunk_id: "test-chunk-1",
        text_content: "stub context",
        granth: "Test Granth",
        page_number: 1,
        file_url: "http://example.com/f1",
      }];
    },
    async navigate() {
      return [];
    },
    async findSimilar() {
      return [];
    },
    async getFilterOptions() {
      return { granths: [], anuyogs: [], contributors: [] };
    },
    async getMetadataOptions() {
      return [];
    },
    async getPravachan() {
      return [];
    },
  };
}
