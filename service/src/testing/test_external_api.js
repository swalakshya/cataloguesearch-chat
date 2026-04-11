export function buildTestExternalApiClient() {
  return {
    async search() {
      return [{ id: "c1", t: "stub context", file_url: "http://example.com/f1" }];
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
