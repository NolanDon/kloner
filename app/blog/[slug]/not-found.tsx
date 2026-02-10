import Link from "next/link";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";

export default function BlogPostNotFound() {
  return (
    <main className="min-h-screen bg-white text-neutral-900">
      <NavBar />
      <section className="pt-[calc(var(--header-h,56px)+40px)] pb-14 px-6">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Post not found</h1>
          <p className="mt-3 text-neutral-600">
            That article doesn’t exist (or the URL changed). Browse the latest posts instead.
          </p>
          <div className="mt-6">
            <Link href="/blog" className="inline-flex rounded-full border border-neutral-200 px-5 py-2 text-sm hover:border-neutral-300">
              Go to blog
            </Link>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
