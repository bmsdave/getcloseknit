import { nearbyCommonsPhotos, type CommonsPhoto } from "@/lib/commons";
import { nearbyGeographLinks } from "@/lib/geograph";
import { lookupPostcode } from "@/lib/postcode-search";

// "Around here": photos nearest the postcode's centre. Wikimedia Commons
// photos show as images (Commons allows embedding), each credited with its
// own author and licence; Geograph photos are credited links to Geograph,
// which asks that its images are not hotlinked. Nothing at all when neither
// source has a photo, so the page never waits on them.
export async function PostcodePhotos({ postcode, testId = "postcode-photos" }: { postcode: string; testId?: string }) {
  const lookup = await lookupPostcode(postcode);
  if (lookup?.latitude == null || lookup.longitude == null) return null;
  const images = await nearbyCommonsPhotos(lookup.latitude, lookup.longitude);
  const shown = new Set(images.map((photo) => photo.geographId).filter((id): id is string => id !== null));
  const geograph = await nearbyGeographLinks(lookup.latitude, lookup.longitude, shown);
  if (images.length === 0 && geograph.links.length === 0) return null;
  return (
    <section className="postcode-photos" aria-labelledby="postcode-photos-title" data-testid={testId}>
      <div className="postcode-section-head">
        <h2 id="postcode-photos-title">Around here</h2>
      </div>
      {images.length > 0 && (
        <ul className="postcode-photos__grid">
          {images.map((photo) => <CommonsFigure key={photo.id} photo={photo} />)}
        </ul>
      )}
      {geograph.links.length > 0 && (
        <div className="postcode-photos__more" data-testid="postcode-photos-geograph">
          <h3>More photos nearby on Geograph</h3>
          <ul>
            {geograph.links.map((link) => (
              <li key={link.id}>
                <a href={link.pageUrl} rel="noopener noreferrer" target="_blank">{link.title}</a>
                <span className="licence-note"> © {link.photographer}, {link.metres} m away</span>
              </li>
            ))}
          </ul>
          <p className="licence-note">
            Geograph photos are{" "}
            <a href={geograph.licenceUrl} rel="license noopener noreferrer" target="_blank">CC BY-SA 2.0</a>; they open on Geograph.
          </p>
        </div>
      )}
      <p className="quality-note">
        Photos from Wikimedia Commons and Geograph Britain and Ireland, nearest to the postcode&rsquo;s centre; not
        necessarily of these homes.
      </p>
    </section>
  );
}

function CommonsFigure({ photo }: { photo: CommonsPhoto }) {
  return (
    <li>
      <figure>
        <a href={photo.pageUrl} rel="noopener noreferrer" target="_blank">
          {/* eslint-disable-next-line @next/next/no-img-element -- Wikimedia's own thumbnails; no optimiser in between */}
          <img src={photo.imageUrl} alt={photo.title} width={photo.width} height={photo.height} loading="lazy" referrerPolicy="no-referrer" />
        </a>
        <figcaption>
          <span className="postcode-photos__title">{photo.title}</span>
          <span className="licence-note">
            {photo.author && <>© <a href={photo.pageUrl} rel="noopener noreferrer" target="_blank">{photo.author}</a>, </>}
            {photo.licenceUrl
              ? <a href={photo.licenceUrl} rel="license noopener noreferrer" target="_blank">{photo.licence}</a>
              : photo.licence}
          </span>
        </figcaption>
      </figure>
    </li>
  );
}
