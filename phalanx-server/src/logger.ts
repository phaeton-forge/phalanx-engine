/** Fault log. `console.error` is the only channel the lint rule allows. */
export const logger = {
  error(message: string): void {
    console.error(message);
  },
};
