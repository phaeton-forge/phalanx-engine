/**
 * EventBus - Generic event bus for decoupled communication between systems
 * This is a pure event bus implementation with no dependencies on game systems
 */

type EventCallback<T = unknown> = (data: T) => void;
type UnsubscribeFunction = () => void;

interface Subscription {
  callback: EventCallback<unknown>;
  once: boolean;
}

export class EventBus {
  private listeners: Map<string, Subscription[]> = new Map();

  /**
   * Subscribe to an event
   * @param eventType - The event type to subscribe to
   * @param callback - The callback to invoke when the event is emitted
   * @returns Unsubscribe function
   */
  public on<T>(
    eventType: string,
    callback: EventCallback<T>
  ): UnsubscribeFunction {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }

    const subscription: Subscription = {
      callback: callback as EventCallback<unknown>,
      once: false,
    };

    this.listeners.get(eventType)!.push(subscription);

    return () => this.off(eventType, callback);
  }

  /**
   * Subscribe to an event once (automatically unsubscribes after first invocation)
   * @param eventType - The event type to subscribe to
   * @param callback - The callback to invoke when the event is emitted
   * @returns Unsubscribe function
   */
  public once<T>(
    eventType: string,
    callback: EventCallback<T>
  ): UnsubscribeFunction {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }

    const subscription: Subscription = {
      callback: callback as EventCallback<unknown>,
      once: true,
    };

    this.listeners.get(eventType)!.push(subscription);

    return () => this.off(eventType, callback);
  }

  /**
   * Unsubscribe from an event
   * @param eventType - The event type to unsubscribe from
   * @param callback - The callback to remove
   */
  public off<T>(eventType: string, callback: EventCallback<T>): void {
    const subscriptions = this.listeners.get(eventType);
    if (!subscriptions) return;

    const index = subscriptions.findIndex((sub) => sub.callback === callback);
    if (index !== -1) {
      subscriptions.splice(index, 1);
    }

    // Clean up empty arrays
    if (subscriptions.length === 0) {
      this.listeners.delete(eventType);
    }
  }

  /**
   * Emit an event to all subscribers
   * @param eventType - The event type to emit
   * @param data - The event data
   */
  public emit<T>(eventType: string, data: T): void {
    const subscriptions = this.listeners.get(eventType);
    if (!subscriptions) return;

    // Create a copy to avoid issues if callbacks modify the subscription list
    const subscriptionsCopy = [...subscriptions];
    const toRemove: Subscription[] = [];

    for (const subscription of subscriptionsCopy) {
      subscription.callback(data);

      if (subscription.once) {
        toRemove.push(subscription);
      }
    }

    // Remove once subscriptions
    for (const subscription of toRemove) {
      const index = subscriptions.indexOf(subscription);
      if (index !== -1) {
        subscriptions.splice(index, 1);
      }
    }

    // Clean up empty arrays
    if (subscriptions.length === 0) {
      this.listeners.delete(eventType);
    }
  }

  /**
   * Remove all listeners for a specific event type
   * @param eventType - The event type to clear
   */
  public clear(eventType: string): void {
    this.listeners.delete(eventType);
  }

  /**
   * Remove all listeners
   */
  public clearAll(): void {
    this.listeners.clear();
  }

  /**
   * Get the number of listeners for a specific event type
   * @param eventType - The event type to check
   */
  public listenerCount(eventType: string): number {
    return this.listeners.get(eventType)?.length ?? 0;
  }
}

// Export a singleton instance for global access
export const globalEventBus = new EventBus();
