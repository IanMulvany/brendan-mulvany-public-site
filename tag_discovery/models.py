from dataclasses import dataclass, asdict
from typing import List, Optional


@dataclass
class TagCandidate:
    """A potential tag discovered from the corpus."""

    term: str
    category: str
    count: int
    sample_scene_ids: List[str]

    def to_dict(self):
        return asdict(self)


@dataclass
class TagSuggestion:
    """A tag suggestion that can be accepted, discarded, or merged."""

    term: str
    category: str
    count: int
    sample_scene_ids: List[str]
    suggested_at: str
    status: str  # "pending", "accepted", "discarded", "merged"
    merged_into: Optional[str] = None  # If merged, the term it was merged into

    def to_dict(self):
        return asdict(self)


@dataclass
class CuratedTag:
    """A tag that has been approved for use."""

    name: str
    display_name: str
    category: str
    keywords: List[str]
    created_at: str
