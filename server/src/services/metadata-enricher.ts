import axios from 'axios';
import { logger } from '../utils/logger';
import { config } from '../utils/config';
import { GoogleBooksResult, OpenLibraryResult, ExtractedMetadata } from '../types';

export class MetadataEnricher {
  private googleBooksApiKey: string;

  constructor(apiKey: string = config.googleBooksApiKey) {
    this.googleBooksApiKey = apiKey;
  }

  /**
   * Enrich metadata by querying external APIs
   */
  async enrich(metadata: ExtractedMetadata): Promise<ExtractedMetadata> {
    let enriched = { ...metadata };

    // Try Google Books first
    try {
      const googleResult = await this.searchGoogleBooks(metadata);
      if (googleResult) {
        const googleMetadata = await this.convertGoogleBooks(googleResult);
        enriched = this.mergeMetadata(enriched, googleMetadata);
      }
    } catch (error) {
      logger.error('Google Books enrichment failed:', error);
    }

    // Try Open Library as fallback
    if (!enriched.description || !enriched.coverImage) {
      try {
        const openLibResult = await this.searchOpenLibrary(metadata);
        if (openLibResult) {
          const openLibMetadata = await this.convertOpenLibrary(openLibResult);
          enriched = this.mergeMetadata(enriched, openLibMetadata);
        }
      } catch (error) {
        logger.error('Open Library enrichment failed:', error);
      }
    }

    return enriched;
  }

  /**
   * Search Google Books API
   */
  private async searchGoogleBooks(metadata: ExtractedMetadata): Promise<GoogleBooksResult | null> {
    try {
      let query = '';

      // Prefer ISBN lookup
      if (metadata.isbn) {
        query = `isbn:${metadata.isbn}`;
      } else if (metadata.title && metadata.authors && metadata.authors.length > 0) {
        query = `intitle:${metadata.title}+inauthor:${metadata.authors[0]}`;
      } else if (metadata.title) {
        query = `intitle:${metadata.title}`;
      } else {
        return null;
      }

      const url = 'https://www.googleapis.com/books/v1/volumes';
      const params: any = { q: query, maxResults: 1 };

      if (this.googleBooksApiKey) {
        params.key = this.googleBooksApiKey;
      }

      const response = await axios.get(url, {
        params,
        timeout: 10000,
      });

      if (response.data.totalItems === 0) {
        return null;
      }

      const book = response.data.items[0];
      const volumeInfo = book.volumeInfo;

      return {
        title: volumeInfo.title,
        subtitle: volumeInfo.subtitle,
        authors: volumeInfo.authors || [],
        publisher: volumeInfo.publisher,
        publishedDate: volumeInfo.publishedDate,
        description: volumeInfo.description,
        pageCount: volumeInfo.pageCount,
        categories: volumeInfo.categories,
        language: volumeInfo.language,
        imageLinks: volumeInfo.imageLinks,
        isbn_10: volumeInfo.industryIdentifiers?.find((id: any) => id.type === 'ISBN_10')?.identifier,
        isbn_13: volumeInfo.industryIdentifiers?.find((id: any) => id.type === 'ISBN_13')?.identifier,
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 429) {
        logger.warn('Google Books API rate limit reached');
      } else {
        logger.error('Google Books API error:', error);
      }
      return null;
    }
  }

  /**
   * Search Open Library API
   */
  private async searchOpenLibrary(metadata: ExtractedMetadata): Promise<OpenLibraryResult | null> {
    try {
      let url = '';

      // Prefer ISBN lookup
      if (metadata.isbn) {
        url = `https://openlibrary.org/api/books?bibkeys=ISBN:${metadata.isbn}&format=json&jscmd=data`;
      } else if (metadata.title) {
        // Search by title
        const searchUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(metadata.title)}`;
        if (metadata.authors && metadata.authors.length > 0) {
          searchUrl + `&author=${encodeURIComponent(metadata.authors[0])}`;
        }

        const searchResponse = await axios.get(searchUrl, { timeout: 10000 });

        if (searchResponse.data.docs && searchResponse.data.docs.length > 0) {
          const doc = searchResponse.data.docs[0];
          return {
            title: doc.title,
            authors: doc.author_name?.map((name: string) => ({ name })) || [],
            publishers: doc.publisher,
            publish_date: doc.first_publish_year?.toString(),
            number_of_pages: doc.number_of_pages_median,
            isbn_10: doc.isbn?.[0],
            isbn_13: doc.isbn?.[1],
            subjects: doc.subject?.slice(0, 10),
            covers: doc.cover_i ? [doc.cover_i] : undefined,
          };
        }

        return null;
      } else {
        return null;
      }

      const response = await axios.get(url, { timeout: 10000 });
      const key = Object.keys(response.data)[0];

      if (!key) {
        return null;
      }

      const book = response.data[key];

      return {
        title: book.title,
        authors: book.authors || [],
        publishers: book.publishers?.map((p: any) => p.name),
        publish_date: book.publish_date,
        number_of_pages: book.number_of_pages,
        isbn_10: book.identifiers?.isbn_10?.[0],
        isbn_13: book.identifiers?.isbn_13?.[0],
        subjects: book.subjects?.map((s: any) => s.name).slice(0, 10),
        covers: book.cover ? [book.cover.large, book.cover.medium, book.cover.small].filter(Boolean) : undefined,
      };
    } catch (error) {
      logger.error('Open Library API error:', error);
      return null;
    }
  }

  /**
   * Convert Google Books result to standard format
   */
  private async convertGoogleBooks(result: GoogleBooksResult): Promise<ExtractedMetadata> {
    const metadata: ExtractedMetadata = {};

    if (result.title) metadata.title = result.title;
    if (result.authors) metadata.authors = result.authors;
    if (result.publisher) metadata.publisher = result.publisher;
    if (result.publishedDate) metadata.publishedDate = result.publishedDate;
    if (result.description) metadata.description = result.description;
    if (result.pageCount) metadata.pageCount = result.pageCount;
    if (result.language) metadata.language = result.language;
    if (result.isbn_13) metadata.isbn = result.isbn_13;
    else if (result.isbn_10) metadata.isbn = result.isbn_10;

    // Download cover image if available
    if (result.imageLinks?.thumbnail) {
      try {
        const coverUrl = result.imageLinks.thumbnail.replace('http:', 'https:');
        const response = await axios.get(coverUrl, {
          responseType: 'arraybuffer',
          timeout: 10000,
        });
        metadata.coverImage = Buffer.from(response.data);
        logger.info('Downloaded cover from Google Books');
      } catch (error) {
        logger.error('Failed to download Google Books cover:', error);
      }
    }

    return metadata;
  }

  /**
   * Convert Open Library result to standard format
   */
  private async convertOpenLibrary(result: OpenLibraryResult): Promise<ExtractedMetadata> {
    const metadata: ExtractedMetadata = {};

    if (result.title) metadata.title = result.title;
    if (result.authors) metadata.authors = result.authors.map(a => a.name);
    if (result.publishers) metadata.publisher = result.publishers[0];
    if (result.publish_date) metadata.publishedDate = result.publish_date;
    if (result.number_of_pages) metadata.pageCount = result.number_of_pages;
    if (result.isbn_13) metadata.isbn = result.isbn_13[0];
    else if (result.isbn_10) metadata.isbn = result.isbn_10[0];

    // Download cover image if available
    if (result.covers && result.covers.length > 0) {
      try {
        const coverId = result.covers[0];
        const coverUrl = `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
        const response = await axios.get(coverUrl, {
          responseType: 'arraybuffer',
          timeout: 10000,
        });
        metadata.coverImage = Buffer.from(response.data);
        logger.info('Downloaded cover from Open Library');
      } catch (error) {
        logger.error('Failed to download Open Library cover:', error);
      }
    }

    return metadata;
  }

  /**
   * Merge metadata, preferring non-empty values from source
   */
  private mergeMetadata(base: ExtractedMetadata, enrichment: ExtractedMetadata): ExtractedMetadata {
    const merged = { ...base };

    Object.entries(enrichment).forEach(([key, value]) => {
      if (value && (!merged[key as keyof ExtractedMetadata] || merged[key as keyof ExtractedMetadata] === '')) {
        (merged as any)[key] = value;
      }
    });

    return merged;
  }
}
