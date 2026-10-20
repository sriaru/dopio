import Link from "next/link";

type ArtistCardProps = {
  id: string;
  name: string;
  genre: string;
  projects: number;
  status: "Active" | "On Hold";
};

export default function ArtistCard({
  id,
  name,
  genre,
  projects,
  status,
}: ArtistCardProps) {
  return (
    <Link href={`/artists/${id}`}>
      <div className="cursor-pointer rounded-xl border border-gray-200 bg-white p-4 transition hover:border-gray-400 hover:shadow-sm">
        <div className="flex items-center gap-4">

          <div className="h-20 w-20 shrink-0 rounded-lg bg-gray-200" />

          <div>
            <h3 className="text-lg font-semibold">{name}</h3>

            <p className="text-sm text-copy">
              {genre}
            </p>

            <p className="mt-1 text-sm text-copy">
              {projects} active {projects === 1 ? "project" : "projects"}
            </p>

            <div className="mt-2 flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  status === "Active"
                    ? "bg-green-500"
                    : "bg-yellow-500"
                }`}
              />

              <span className="text-sm text-copy">
                {status}
              </span>
            </div>

          </div>
        </div>
      </div>
    </Link>
  );
}