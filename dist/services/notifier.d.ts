export declare function notifyNewOrder(order: any): void;
export declare function notifyPaid(order: any): void;
export declare function notifyCompleted(order: any): void;
export declare function notifyCancelled(order: any): void;
export declare function notifyExpired(order: any): void;
declare const _default: {
    notifyNewOrder: typeof notifyNewOrder;
    notifyPaid: typeof notifyPaid;
    notifyCompleted: typeof notifyCompleted;
    notifyCancelled: typeof notifyCancelled;
    notifyExpired: typeof notifyExpired;
};
export default _default;
