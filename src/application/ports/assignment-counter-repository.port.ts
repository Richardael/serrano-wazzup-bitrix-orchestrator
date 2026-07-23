export interface AssignmentCounterRepository {
  getCurrentIndex(): Promise<number>;
  incrementAndGet(): Promise<number>;
}
