# Ladybug Stitch shop setup

The shop lives at `/shop` on the existing website. Products, prices, images and stock come from the existing Square catalog. Customers choose shipping or local pickup on this site, then go to Square's secure payment page. No Square Online storefront is required.

## Current status

The code is prepared for Azure Static Web Apps. It has not been connected to the seller's Square account or verified with a real Square checkout. Checkout is disabled unless all configuration below is present and `SHOP_CHECKOUT_ENABLED` is explicitly `true`.

The owner requested both shipping and pickup, with shipping **starting at $7.99**. The example uses 799 cents as a provisional base. The current checkout implementation charges one configured flat fee per shipping order. It does not calculate carrier rates, weight bands, destination surcharges, or block unsupported shipping addresses. Confirm the final rate rule and shipping area before enabling sales; extend the shipping calculation if $7.99 is only one tier. Pickup location and instructions are still required.

## Your wife's everyday workflow

1. Sign into the same Square account used at markets and open the Item Library.
2. Create a category named **Website Shop**. Add only ready-made products that should be offered on this website to that category. Existing market-only items stay private to Square.
3. For each product, add a name, description, photo and fixed price. Create variations for sizes/colors and enter stock for each variation at the selected market location. Enable inventory tracking. Items with variable prices, untracked stock, required modifiers, or fractional units are not supported by this ready-made shop.
4. Optionally add categories such as **Halloween**, **Christmas**, or **Everyday favorites**. They become filters in the shop. Keep the **Website Shop** category on every item you want displayed.
5. Save in Square and refresh the Shop page. A zero-stock size is shown as sold out. Remove the Website Shop category to stop displaying a product online, or archive it.
6. Continue using the same item variations and location for market sales. The website reads stock from that location; it does not create a second inventory list.

No GitHub edit or deployment is needed to add products after the connection is configured. Square's catalog API supports reading the seller's existing items and variations: [Catalog API](https://developer.squareup.com/docs/catalog-api/what-it-does).

## One-time Square and Azure connection

Create an application in the seller's [Square Developer Console](https://developer.squareup.com/apps). Start with Sandbox credentials and a Sandbox location. Sandbox inventory is separate from the production market catalog; create a small test catalog there.

The integration needs catalog and inventory read access plus order and payment-link creation access (`ITEMS_READ`, `INVENTORY_READ`, `ORDERS_READ`, `ORDERS_WRITE`, `PAYMENTS_WRITE` if using OAuth). A personal access token for this single seller is kept only in Azure backend settings. Do not put a token in HTML, JavaScript, GitHub, a screenshot, or chat.

In the Azure portal, select the Static Web App serving ladybugstitch.com, then its environment's application settings. Add these backend values. Preview environments must use Sandbox credentials and their own exact origin. [Azure application settings](https://learn.microsoft.com/en-us/azure/static-web-apps/application-settings).

| Setting | Value |
| --- | --- |
| `SQUARE_ENVIRONMENT` | `sandbox` for testing; `production` only after testing |
| `SQUARE_ACCESS_TOKEN` | Secret token for that environment, entered directly in Azure |
| `SQUARE_LOCATION_ID` | Location matching that token/environment; production should use the stock location used at markets |
| `SHOP_CATEGORY_NAME` | `Website Shop` |
| `SHOP_CURRENCY` | `USD` (must match item prices and the seller location) |
| `SHOP_SITE_ORIGIN` | Exact website origin, e.g. `https://www.ladybugstitch.com`, no trailing slash. The shopper must use this hostname. For a preview, use its preview origin. |
| `SHOP_SHIPPING_FEE_CENTS` | `799` as the provisional starting amount; confirm the flat-rate rule before launch |
| `SHOP_SHIPPING_DESCRIPTION` | Customer-facing service area, processing time and shipping policy; currently undecided |
| `SHOP_PICKUP_INSTRUCTIONS` | Customer-facing pickup area/location and how to arrange collection; currently undecided. Anything entered here is public. |
| `SHOP_CHECKOUT_ENABLED` | Keep `false` until setup and checkout tests pass; then set `true` |

The active Azure workflow runs tests, builds a public-only `dist/` directory, and deploys `api/` as managed Node.js 22 Functions. Only public HTML, images and assets are copied to `dist/`; source, tests and settings files are excluded. DNS confirms that `www.ladybugstitch.com` points to `kind-coast-0441d320f.7.azurestaticapps.net`; configure that Azure resource. The older `salmon-stone-011ded70f` workflow already failed on main before this change and its deployment credential is invalid. It is retained as a manual-only workflow so it no longer creates duplicate failing deployments. No Azure resource or credential has been deleted.

## Orders and fulfillment

The cart's shipping/pickup choice is recorded on the Square order and payment note. Shipping checkout asks for an address and adds the configured fee; pickup checkout asks for a contact name and phone number. Pickup scheduling is manual using the instructions you provide. This version does not create pickup time slots, buy shipping labels, send its own order emails, or maintain a separate admin dashboard.

Use Square payment records/receipts to confirm payment before handing over or shipping an item. A browser return to `/shop?checkout=returned` is not proof of payment; the site deliberately does not mark it as paid or clear the bag automatically. Orders may need to be completed manually in Square Orders Manager. API-generated payment links themselves are not listed in the Dashboard's payment-links list. [Square checkout behavior](https://developer.squareup.com/docs/checkout-api/common-pitfalls).

Prices are verified server-side and line items reference Square variation IDs. Configured catalog taxes are auto-applied; this is not a destination tax engine. Review the seller's shipping and tax configuration before launch. Shipping address fields and a fee are supported by [Square Checkout options](https://developer.squareup.com/docs/checkout-api/optional-checkout-configurations).

Stock is checked when loading the catalog and immediately before generating a checkout link. This does **not reserve stock** while a buyer stays on Square's payment page. Simultaneous market/online purchases can still oversell the final item. Do not promise guaranteed last-item availability. Before production use, verify inventory changes after a completed order with the seller's account, decide on an acceptable stock buffer or dedicated online allocation, and add a reservation/payment workflow if strict prevention is required. No inventory is manually decremented by this implementation, avoiding double deductions alongside Square.

## Verification before launch

- Run `npm test` and `npm run build` (Node.js 22 is used in CI).
- On the Azure preview, verify `/shop`, `/api/shop/products`, desktop/mobile navigation and the existing custom-order form.
- With Sandbox settings, complete one shipping and one pickup test. Check size, quantity, price, tax, delivery fee, contact information and return behavior.
- Check insufficient stock, changed prices, deleted products, a canceled payment and a repeated checkout attempt. Verify no duplicate payment is produced by retrying an attempt.
- Confirm where your wife sees the paid order, shipping address or pickup contact, notifications, and fulfillment state in Square.
- Verify stock behavior with the actual account before offering limited stock. Sandbox behavior can differ from production. Do not charge a real card without the owner's explicit authorization for the test.
- Confirm shipping policy, pickup instructions and the $7.99 minimum rule. Then connect production settings and enable checkout.

## Local preview

`npm run preview -- --demo` opens `http://localhost:4173/shop` with clearly labeled sample listings and disabled payment. Sample products exist only in the local preview script and are never included in the deployed website.

For an API preview, copy `api/local.settings.example.json` to `api/local.settings.json`, fill Sandbox values locally, and run `npm run preview`. The local settings file is ignored by Git. Keep `SHOP_SITE_ORIGIN=http://localhost:4173` for this local Sandbox preview. The local server is for development, not production hosting.
