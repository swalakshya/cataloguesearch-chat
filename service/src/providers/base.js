export class LLMProvider {
  name() {
    throw new Error("Not implemented");
  }

  startSession() {
    return null;
  }

  closeSession() {}

  async completeText() {
    throw new Error("Not implemented");
  }

  async completeJson() {
    throw new Error("Not implemented");
  }
}
