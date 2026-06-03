// pricing-calculator.ts — Proration, discount, upgrade/downgrade math
// Pure functions, no side effects — usable from any runtime

export interface CycleInfo {
  billingCycleStart: Date;
  billingCycleEnd: Date;
  currentPrice: number;
}

export interface UpgradeParams {
  cycle: CycleInfo;
  newPrice: number;
  now?: Date;
}

export interface DiscountInfo {
  originalPrice: number;
  discountAmount: number;
  discountEndDate: Date | null;
  upgradeKeepsDiscount: boolean;
}

// ====================================================
// Proration calculation for upgrades
// Returns the amount to charge NOW via checkout preference
// ====================================================
export function calculateUpgradeProration(params: UpgradeParams): number {
  const now = params.now || new Date();
  const cycleStart = params.cycle.billingCycleStart.getTime();
  const cycleEnd = params.cycle.billingCycleEnd.getTime();
  const nowMs = now.getTime();
  
  const totalMs = cycleEnd - cycleStart;
  const remainingMs = Math.max(0, cycleEnd - nowMs);
  
  if (totalMs <= 0 || remainingMs <= 0) {
    // Cycle already ended — charge full price difference
    return params.newPrice - params.cycle.currentPrice;
  }
  
  const remainingRatio = remainingMs / totalMs;
  const priceDiff = params.newPrice - params.cycle.currentPrice;
  
  if (priceDiff <= 0) return 0; // Not an upgrade
  
  // Proration: difference * remaining time ratio
  const prorated = remainingRatio * priceDiff;
  
  // Round up to avoid charging less than we should
  return Math.ceil(prorated * 100) / 100;
}

// ====================================================
// Calculate remaining days in current billing cycle
// ====================================================
export function getRemainingDays(cycle: CycleInfo, now?: Date): number {
  const nowMs = (now || new Date()).getTime();
  const endMs = cycle.billingCycleEnd.getTime();
  const remainingMs = Math.max(0, endMs - nowMs);
  return Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
}

// ====================================================
// Calculate total cycle duration in days
// ====================================================
export function getCycleDays(cycle: CycleInfo): number {
  const ms = cycle.billingCycleEnd.getTime() - cycle.billingCycleStart.getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

// ====================================================
// Apply discount logic on upgrade
// ====================================================
export function calculateUpgradePriceWithDiscount(
  oldPlanPrice: number,
  newPlanPrice: number,
  discount: DiscountInfo | null,
): {
  upgradeChargePrice: number;
  newSubscriptionPrice: number;
  clearDiscount: boolean;
} {
  if (!discount) {
    return {
      upgradeChargePrice: newPlanPrice,
      newSubscriptionPrice: newPlanPrice,
      clearDiscount: false,
    };
  }
  
  if (discount.upgradeKeepsDiscount && discount.originalPrice > 0) {
    // Keep the same discount percentage on the new plan
    const discountPercent = 1 - (discount.discountAmount / discount.originalPrice);
    const newDiscountedPrice = Math.round(newPlanPrice * discountPercent * 100) / 100;
    
    return {
      upgradeChargePrice: newDiscountedPrice,
      newSubscriptionPrice: newDiscountedPrice,
      clearDiscount: false, // Keep discount until discount_end_date
    };
  }
  
  // Upgrade clears discount
  return {
    upgradeChargePrice: newPlanPrice,
    newSubscriptionPrice: newPlanPrice,
    clearDiscount: true,
  };
}

// ====================================================
// Calculate downgrade price with discount
// ====================================================
export function calculateDowngradePriceWithDiscount(
  newPlanPrice: number,
  discount: DiscountInfo | null,
): number {
  if (!discount) return newPlanPrice;
  
  // Downgrades always lose the discount (simplest approach)
  // If the new plan has its own price structure, use that
  return newPlanPrice;
}


