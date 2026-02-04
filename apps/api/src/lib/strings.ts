import { isSelfHosted } from "./deployment";

export const BLOCKLISTED_URL_MESSAGE = isSelfHosted()
  ? "This website has been blocklisted and cannot be scraped. Websites may be blocklisted due to: (1) Terms of service restrictions, (2) Legal requirements, (3) Technical limitations that prevent reliable scraping, or (4) Site owner requests. Please check your server configuration and logs for more details about why this specific domain is blocked."
  : "We apologize for the inconvenience but we do not support this site. If you are part of an enterprise and want to have a further conversation about this, please fill out our intake form here: https://fk4bvu0n5qp.typeform.com/to/Ej6oydlg";
