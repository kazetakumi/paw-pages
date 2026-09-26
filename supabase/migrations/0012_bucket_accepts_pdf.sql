-- Lets the pet-photos bucket take PDFs, for documents sent through chat --
-- a vet invoice, a vaccination certificate as a PDF. v2.
--
-- Widens 0003's allow-list; the size limit and every storage policy stay
-- as they are. v1 only ever uploads the four image types already on the
-- list, so it can't observe this. The bucket keeps its name: renaming a
-- bucket every policy keys off isn't additive.

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
where id = 'pet-photos';
